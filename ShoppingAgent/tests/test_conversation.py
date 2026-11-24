from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from fastapi.testclient import TestClient

from app.cart import router as cart_routes
from app.cart.repository import CartRepository
from app.conversation.models import BeginTurn, CompleteTurn, ConversationMemory
from app.conversation.repository import ConversationRepository
from app.main import app
from app.shared.errors import AgentToolError


def session(client):
    cart_id = client.post("/carts").json()["id"]
    return cart_id, f"/carts/{cart_id}/conversation"


def begin(client, path, request_id="turn-1", message="I have model WDT780SAEM1"):
    response = client.post(path + "/turns", json={"request_id": request_id, "message": message})
    assert response.status_code == 200, response.text
    return response.json()


def complete_body(token):
    return {"token": token, "memory": {"currentModelNumber": "WDT780SAEM1"},
            "response": {"message": "Model saved", "tool": "updateContext", "intent": "context_update", "responseTimeMs": 2}}


def expire(cart_id):
    with closing(cart_routes.get_cart_repository().connect()) as connection, connection:
        connection.execute("UPDATE conversation_turns SET expires_at = 0 WHERE cart_id = ?", (cart_id,))


def test_conversation_completion_and_replay_are_atomic():
    with TestClient(app) as client:
        _, path = session(client)
        started = begin(client, path)
        assert started["memory"]["currentModelNumber"] is None
        body = complete_body(started["token"])
        for _ in range(2):
            saved = client.put(path + "/turns/turn-1", json=body)
            assert saved.status_code == 200
            assert saved.json()["version"] == 1
        replay = begin(client, path)
        assert replay["replayed"] is True
        assert replay["response"]["message"] == "Model saved"
        restored = client.get(path).json()
        assert restored["memory"]["currentModelNumber"] == "WDT780SAEM1"
        assert len(restored["turns"]) == 1
        assert restored["turns"][0]["status"] == "completed"


def test_busy_conversation_and_reused_request_id_are_rejected():
    with TestClient(app) as client:
        _, path = session(client)
        begin(client, path)
        same = client.post(path + "/turns", json={"request_id": "turn-1", "message": "I have model WDT780SAEM1"})
        assert same.status_code == 409
        assert same.json()["error"]["code"] == "conversation_busy"
        changed = client.post(path + "/turns", json={"request_id": "turn-1", "message": "Different prompt"})
        assert changed.status_code == 409
        assert changed.json()["error"]["code"] == "idempotency_conflict"
        another = client.post(path + "/turns", json={"request_id": "turn-2", "message": "Another message"})
        assert another.status_code == 409


def test_failed_turn_preserves_memory_and_can_retry():
    with TestClient(app) as client:
        _, path = session(client)
        first = begin(client, path)
        failed = client.post(path + "/turns/turn-1/fail", json={"token": first["token"], "error": "Tool unavailable"})
        assert failed.status_code == 200
        state = client.get(path).json()
        assert state["version"] == 0
        assert state["memory"]["currentModelNumber"] is None
        assert state["turns"][0]["error"] == "Tool unavailable"
        retry = begin(client, path)
        assert retry["token"] != first["token"]
        assert client.put(path + "/turns/turn-1", json=complete_body(first["token"])).status_code == 409
        assert client.put(path + "/turns/turn-1", json=complete_body(retry["token"])).status_code == 200


def test_expired_turn_cannot_write_or_overwrite_new_turn():
    with TestClient(app) as client:
        cart_id, path = session(client)
        first = begin(client, path)
        expire(cart_id)
        stale_headers = {"Idempotency-Key": "turn-1", "X-Conversation-Request": "turn-1", "X-Conversation-Token": first["token"]}
        stale_write = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 1}, headers=stale_headers)
        assert stale_write.status_code == 409
        assert client.get(f"/carts/{cart_id}").json()["item_count"] == 0
        second = begin(client, path, "turn-2", "A new turn")
        assert client.put(path + "/turns/turn-1", json=complete_body(first["token"])).status_code == 409
        assert client.put(path + "/turns/turn-2", json=complete_body(second["token"])).status_code == 200


def test_committed_cart_write_is_not_repeated_after_turn_recovery():
    with TestClient(app) as client:
        cart_id, path = session(client)
        started = begin(client, path)
        headers = {"Idempotency-Key": "turn-1", "X-Conversation-Request": "turn-1", "X-Conversation-Token": started["token"]}
        cart_path = f"/carts/{cart_id}/items"
        assert client.post(cart_path, json={"product_id": "prod_001", "quantity": 1}, headers=headers).json()["item_count"] == 1
        expire(cart_id)
        recovered = begin(client, path)
        headers["X-Conversation-Token"] = recovered["token"]
        assert client.post(cart_path, json={"product_id": "prod_001", "quantity": 1}, headers=headers).json()["item_count"] == 1
        assert client.put(path + "/turns/turn-1", json=complete_body(recovered["token"])).status_code == 200
        assert client.get(f"/carts/{cart_id}").json()["item_count"] == 1


def test_sessions_and_execution_tokens_are_isolated():
    with TestClient(app) as client:
        cart_a, path_a = session(client)
        cart_b, path_b = session(client)
        token_a = begin(client, path_a)["token"]
        begin(client, path_b)
        assert client.put(path_b + "/turns/turn-1", json=complete_body(token_a)).status_code == 409
        assert client.post(f"/carts/{cart_b}/items", json={"product_id": "prod_001", "quantity": 1}, headers={"X-Conversation-Request": "turn-1", "X-Conversation-Token": token_a}).status_code == 409
        assert client.get(f"/carts/{cart_a}").json()["item_count"] == 0
        assert client.get(path_b).json()["version"] == 0


def test_persistence_survives_reopening_repository(tmp_path):
    path = tmp_path / "conversation-restart.sqlite3"
    carts = CartRepository(path)
    cart_id = carts.create().id
    repository = ConversationRepository(carts)
    started = repository.begin(cart_id, BeginTurn(request_id="turn", message="Remember model"))
    repository.complete(cart_id, "turn", CompleteTurn(token=started["token"], memory=ConversationMemory(currentModelNumber="WDT780SAEM1"), response={"message": "Saved"}))
    restored = ConversationRepository(CartRepository(path)).get(cart_id)
    assert restored["memory"]["currentModelNumber"] == "WDT780SAEM1"
    assert restored["turns"][0]["response"]["message"] == "Saved"


def test_concurrent_turn_admission_has_one_winner(tmp_path):
    path = tmp_path / "parallel.sqlite3"
    carts = CartRepository(path)
    cart_id = carts.create().id
    repositories = [ConversationRepository(CartRepository(path)) for _ in range(8)]

    def attempt(index):
        try:
            repositories[index].begin(cart_id, BeginTurn(request_id=f"request-{index}", message="Hello"))
            return "admitted"
        except AgentToolError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(attempt, range(8)))
    assert results.count("admitted") == 1
    assert results.count("conversation_busy") == 7


def test_invalid_requests_do_not_create_or_advance_turns():
    with TestClient(app) as client:
        _, path = session(client)
        for message in ("", "   ", "x" * 4001):
            assert client.post(path + "/turns", json={"request_id": "invalid", "message": message}).status_code == 422
        assert client.get(path).json()["turns"] == []
        started = begin(client, path)
        body = complete_body(started["token"])
        body["memory"]["unexpected"] = "spoofed"
        assert client.put(path + "/turns/turn-1", json=body).status_code == 422
        assert client.get(path).json()["version"] == 0


def test_turn_feedback_and_metrics_endpoint() -> None:
    with TestClient(app) as client:
        cart_id = client.post("/carts").json()["id"]
        base = f"/carts/{cart_id}/conversation"
        started = client.post(f"{base}/turns", json={"request_id": "req-fb-1", "message": "check PS11752778"}).json()
        client.put(
            f"{base}/turns/req-fb-1",
            json={
                "token": started["token"],
                "memory": started["memory"],
                "response": {
                    "message": "Found PS11752778",
                    "intent": "part_lookup",
                    "tool": "getProductDetails",
                    "responseTimeMs": 420,
                    "tokens": {"input": 100, "output": 20, "total": 120},
                },
            },
        )
        fb = client.post(
            f"{base}/turns/req-fb-1/feedback",
            json={"rating": "down", "reason": "compatibility_unclear", "comment": "Need exact model list"},
        )
        assert fb.status_code == 200
        assert fb.json()["rating"] == "down"

        metrics = client.get(f"{base}/metrics")
        assert metrics.status_code == 200
        data = metrics.json()
        assert data["totalTurns"] == 1
        assert data["completedTurns"] == 1
        assert data["totalTokens"] == 120
        assert data["avgLatencyMs"] == 420.0
        assert data["feedback"]["down"] == 1
        assert data["feedback"]["reasons"]["compatibility_unclear"] == 1

        # 确认刷新会话快照后能回显已提交的反馈状态
        snap = client.get(base).json()
        assert snap["turns"][0]["feedback"] == {"rating": "down", "reason": "compatibility_unclear"}
