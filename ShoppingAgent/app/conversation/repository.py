from contextlib import closing
import json
import time
from uuid import uuid4

from app.cart.repository import CartRepository
from app.conversation.models import BeginTurn, CompleteTurn, ConversationMemory, FailTurn, TurnFeedback
from app.shared.errors import AgentToolError


TURN_LEASE_SECONDS = 90


class ConversationRepository:
    def __init__(self, carts: CartRepository):
        self.carts = carts

    def ensure_conversation(self, connection, cart_id: str):
        if connection.execute("SELECT 1 FROM carts WHERE id = ?", (cart_id,)).fetchone() is None:
            raise AgentToolError("cart_not_found", "Cart was not found.", status_code=404)
        connection.execute(
            "INSERT OR IGNORE INTO conversations VALUES (?, ?, 0)",
            (cart_id, ConversationMemory().model_dump_json()),
        )

    def snapshot(self, connection, cart_id: str):
        memory, version = connection.execute("SELECT memory, version FROM conversations WHERE cart_id = ?", (cart_id,)).fetchone()
        rows = connection.execute(
            "SELECT request_id, message, status, response, error, started_at FROM conversation_turns WHERE cart_id = ? ORDER BY started_at DESC, request_id DESC LIMIT 40",
            (cart_id,),
        ).fetchall()
        fb_rows = connection.execute(
            "SELECT request_id, rating, reason FROM turn_feedback WHERE cart_id = ?",
            (cart_id,),
        ).fetchall()
        feedback_map = {row[0]: {"rating": row[1], "reason": row[2]} for row in fb_rows}
        return {
            "memory": json.loads(memory), "version": version,
            "turns": [{"request_id": row[0], "message": row[1], "status": row[2],
                       "response": json.loads(row[3]) if row[3] else None, "error": row[4], "started_at": row[5],
                       "feedback": feedback_map.get(row[0])}
                      for row in reversed(rows)],
        }

    def get(self, cart_id: str):
        with closing(self.carts.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            self.ensure_conversation(connection, cart_id)
            connection.execute(
                "UPDATE conversation_turns SET status = 'failed', error = 'Execution lease expired; retry the same request.' WHERE cart_id = ? AND status = 'running' AND expires_at <= ?",
                (cart_id, time.time()),
            )
            return self.snapshot(connection, cart_id)

    def begin(self, cart_id: str, request: BeginTurn):
        with closing(self.carts.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            self.ensure_conversation(connection, cart_id)
            existing = connection.execute(
                "SELECT message, status, response FROM conversation_turns WHERE cart_id = ? AND request_id = ?",
                (cart_id, request.request_id),
            ).fetchone()
            if existing and existing[0] != request.message:
                raise AgentToolError("idempotency_conflict", "This request ID belongs to a different message.", status_code=409)
            if existing and existing[1] == "completed":
                return {"replayed": True, "response": json.loads(existing[2]), **self.snapshot(connection, cart_id)}

            now = time.time()
            # 租约到期后的旧任务不能再保存状态；购物车写入也校验同一个令牌。
            connection.execute(
                "UPDATE conversation_turns SET status = 'failed', error = 'Execution lease expired; retry the same request.' WHERE cart_id = ? AND status = 'running' AND expires_at <= ?",
                (cart_id, now),
            )
            if connection.execute("SELECT 1 FROM conversation_turns WHERE cart_id = ? AND status = 'running'", (cart_id,)).fetchone():
                raise AgentToolError("conversation_busy", "Another turn is still running. Wait, then retry the same request.", status_code=409)
            token = uuid4().hex
            connection.execute(
                """INSERT INTO conversation_turns (cart_id, request_id, message, status, token, expires_at, started_at)
                   VALUES (?, ?, ?, 'running', ?, ?, ?)
                   ON CONFLICT(cart_id, request_id) DO UPDATE SET status = 'running', token = excluded.token,
                   expires_at = excluded.expires_at, error = NULL, response = NULL""",
                (cart_id, request.request_id, request.message, token, now + TURN_LEASE_SECONDS, now),
            )
            return {"replayed": False, "token": token, **self.snapshot(connection, cart_id)}

    def complete(self, cart_id: str, request_id: str, request: CompleteTurn):
        response = json.dumps(request.response, ensure_ascii=False)
        if len(response.encode("utf-8")) > 131072 or not isinstance(request.response.get("message"), str):
            raise AgentToolError("invalid_turn_response", "Turn response is invalid or too large.")
        with closing(self.carts.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            self.ensure_conversation(connection, cart_id)
            row = connection.execute(
                "SELECT status, token, expires_at FROM conversation_turns WHERE cart_id = ? AND request_id = ?",
                (cart_id, request_id),
            ).fetchone()
            if not row or row[1] != request.token:
                raise AgentToolError("turn_superseded", "This turn no longer owns the conversation.", status_code=409)
            if row[0] == "completed":
                return self.snapshot(connection, cart_id)
            if row[0] != "running" or row[2] <= time.time():
                raise AgentToolError("turn_expired", "This turn expired. Retry the same request.", status_code=409)
            connection.execute("UPDATE conversations SET memory = ?, version = version + 1 WHERE cart_id = ?", (request.memory.model_dump_json(), cart_id))
            connection.execute("UPDATE conversation_turns SET status = 'completed', response = ?, error = NULL WHERE cart_id = ? AND request_id = ?", (response, cart_id, request_id))
            return self.snapshot(connection, cart_id)

    def fail(self, cart_id: str, request_id: str, request: FailTurn):
        response = None
        if request.diagnostics is not None:
            response = json.dumps({
                "message": request.error, "intent": "clarification_needed", "tool": "none",
                **request.diagnostics.model_dump(exclude_none=True),
            }, ensure_ascii=False)
            if len(response.encode("utf-8")) > 32768:
                raise AgentToolError("invalid_run_diagnostics", "Run diagnostics are too large.")
        with closing(self.carts.connect()) as connection, connection:
            self.ensure_conversation(connection, cart_id)
            connection.execute(
                "UPDATE conversation_turns SET status = 'failed', error = ?, response = ? WHERE cart_id = ? AND request_id = ? AND token = ? AND status = 'running'",
                (request.error, response, cart_id, request_id, request.token),
            )
        return {"status": "recorded"}

    def record_feedback(self, cart_id: str, request_id: str, feedback: TurnFeedback):
        with closing(self.carts.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            self.ensure_conversation(connection, cart_id)
            now = time.time()
            connection.execute(
                """INSERT INTO turn_feedback (cart_id, request_id, rating, reason, comment, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(cart_id, request_id) DO UPDATE SET
                   rating = excluded.rating, reason = excluded.reason, comment = excluded.comment, created_at = excluded.created_at""",
                (cart_id, request_id, feedback.rating, feedback.reason, feedback.comment, now),
            )
        return {"status": "recorded", "request_id": request_id, "rating": feedback.rating, "reason": feedback.reason}

    def metrics(self, cart_id: str):
        with closing(self.carts.connect()) as connection:
            self.ensure_conversation(connection, cart_id)
            turn_rows = connection.execute(
                "SELECT status, response FROM conversation_turns WHERE cart_id = ?",
                (cart_id,),
            ).fetchall()
            fb_rows = connection.execute(
                "SELECT rating, reason FROM turn_feedback WHERE cart_id = ?",
                (cart_id,),
            ).fetchall()
        total_turns = len(turn_rows)
        completed = 0
        proposals = 0
        confirmed = 0
        total_tokens = 0
        latencies: list[int] = []
        for status, raw_resp in turn_rows:
            if status == "completed":
                completed += 1
            if raw_resp:
                try:
                    resp = json.loads(raw_resp)
                except ValueError:
                    resp = {}
                if resp.get("cartProposal"):
                    proposals += 1
                msg = str(resp.get("message", ""))
                if resp.get("tool") == "addToCart" and resp.get("cart") and ("Confirmed:" in msg or "已确认" in msg):
                    confirmed += 1
                tokens = resp.get("tokens") or {}
                total_tokens += int(tokens.get("total") or 0)
                if isinstance(resp.get("responseTimeMs"), (int, float)):
                    latencies.append(int(resp["responseTimeMs"]))
        up = sum(1 for r, _ in fb_rows if r == "up")
        down = sum(1 for r, _ in fb_rows if r == "down")
        reasons: dict[str, int] = {}
        for _, reason in fb_rows:
            if reason:
                reasons[reason] = reasons.get(reason, 0) + 1
        return {
            "totalTurns": total_turns,
            "completedTurns": completed,
            "completionRate": round(completed / total_turns, 4) if total_turns else 0.0,
            "cartProposals": proposals,
            "confirmedAdditions": confirmed,
            "totalTokens": total_tokens,
            "avgLatencyMs": round(sum(latencies) / len(latencies), 1) if latencies else 0.0,
            "feedback": {"up": up, "down": down, "reasons": reasons},
        }
