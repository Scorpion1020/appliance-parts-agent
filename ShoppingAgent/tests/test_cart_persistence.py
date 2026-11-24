from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.cart.repository import CartRepository
from app.cart.service import CartService
from app.catalog.repository import CatalogRepository
from app.catalog.service import CatalogService
from app.config import PROJECT_ROOT
from app.shared.errors import AgentToolError
from app.main import app


def make_service(database_path):
    return CartService(CartRepository(database_path), CatalogService(CatalogRepository(PROJECT_ROOT / "data/catalog.json")))


def test_cart_and_operation_survive_reopening_database(tmp_path):
    path = tmp_path / "restart.sqlite3"
    first = make_service(path)
    cart_id = first.create_cart().id
    result = first.add_item(cart_id, "prod_001", 1, "same-request")
    restarted = make_service(path)
    assert restarted.get_cart(cart_id) == result
    assert restarted.add_item(cart_id, "prod_001", 1, "same-request") == result
    assert restarted.get_cart(cart_id).item_count == 1


def test_conflicting_request_id_is_rejected_without_changes(tmp_path):
    service = make_service(tmp_path / "conflict.sqlite3")
    cart_id = service.create_cart().id
    service.add_item(cart_id, "prod_001", 1, "request")
    with pytest.raises(AgentToolError) as error:
        service.add_item(cart_id, "prod_001", 2, "request")
    assert error.value.code == "idempotency_conflict"
    assert service.get_cart(cart_id).item_count == 1


def test_failed_validation_rolls_back_and_does_not_consume_key(tmp_path):
    service = make_service(tmp_path / "rollback.sqlite3")
    cart_id = service.create_cart().id
    with pytest.raises(AgentToolError):
        service.add_item(cart_id, "prod_001", 999, "retry")
    assert service.get_cart(cart_id).item_count == 0
    assert service.add_item(cart_id, "prod_001", 1, "retry").item_count == 1


@pytest.mark.parametrize("same_request", [True, False])
def test_concurrent_requests_do_not_duplicate_or_lose_updates(tmp_path, same_request):
    path = tmp_path / "concurrent.sqlite3"
    service = make_service(path)
    cart_id = service.create_cart().id
    services = [make_service(path) for _ in range(8)]

    def add(index):
        key = "same" if same_request else f"request-{index}"
        return services[index].add_item(cart_id, "prod_001", 1, key)

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(add, range(8)))
    assert service.get_cart(cart_id).item_count == (1 if same_request else 8)


def test_replayed_delete_does_not_delete_later_addition(tmp_path):
    service = make_service(tmp_path / "delete.sqlite3")
    cart_id = service.create_cart().id
    service.add_item(cart_id, "prod_001", 1, "add-1")
    removed = service.remove_item(cart_id, "prod_001", "remove-1")
    service.add_item(cart_id, "prod_001", 1, "add-2")
    assert service.remove_item(cart_id, "prod_001", "remove-1") == removed
    assert service.get_cart(cart_id).item_count == 1


def test_same_key_can_be_used_by_separate_carts(tmp_path):
    service = make_service(tmp_path / "isolation.sqlite3")
    for _ in range(2):
        cart_id = service.create_cart().id
        assert service.add_item(cart_id, "prod_001", 1, "request").item_count == 1


def test_api_validates_keys_and_replays_update_and_delete():
    with TestClient(app) as client:
        cart_id = client.post("/carts").json()["id"]
        path = f"/carts/{cart_id}/items"
        body = {"product_id": "prod_001", "quantity": 1}
        assert client.post(path, json=body, headers={"Idempotency-Key": "bad key"}).status_code == 422
        assert client.get(f"/carts/{cart_id}").json()["item_count"] == 0
        client.post(path, json=body, headers={"Idempotency-Key": "add"})
        item_path = f"{path}/prod_001"
        for _ in range(2):
            response = client.patch(item_path, json={"quantity": 2}, headers={"Idempotency-Key": "update"})
            assert response.status_code == 200
            assert response.json()["item_count"] == 2
        assert client.patch(item_path, json={"quantity": 3}, headers={"Idempotency-Key": "update"}).status_code == 409
        for _ in range(2):
            response = client.delete(item_path, headers={"Idempotency-Key": "delete"})
            assert response.status_code == 200
            assert response.json()["item_count"] == 0
