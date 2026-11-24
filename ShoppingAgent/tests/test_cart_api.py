from decimal import Decimal

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_retired_and_deleted_products_remain_visible_and_removable(monkeypatch):
    from app.catalog.router import get_catalog_repository
    repository = get_catalog_repository()
    original = repository.get_product
    cart_id = client.post("/carts").json()["id"]
    assert client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 1}).status_code == 200
    monkeypatch.setattr(repository, "get_product", lambda product_id: original(product_id).model_copy(update={"available": False}) if product_id == "prod_001" else original(product_id))
    saved = client.get(f"/carts/{cart_id}").json()
    assert saved["items"][0]["available"] is False and Decimal(saved["subtotal"]) == 0
    monkeypatch.setattr(repository, "get_product", lambda product_id: None if product_id == "prod_001" else original(product_id))
    response = client.get(f"/carts/{cart_id}")
    assert response.status_code == 200 and response.json()["items"][0]["unit_price"] is None
    assert client.delete(f"/carts/{cart_id}/items/prod_001").json()["item_count"] == 0


def create_cart() -> str:
    response = client.post("/carts")
    assert response.status_code == 201
    return response.json()["id"]


def test_cart_add_update_remove_and_total() -> None:
    cart_id = create_cart()

    add_response = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 2})
    assert add_response.status_code == 200
    body = add_response.json()
    assert body["item_count"] == 2
    assert body["currency"] == "USD"
    assert Decimal(body["subtotal"]) == Decimal("79.4")

    update_response = client.patch(f"/carts/{cart_id}/items/prod_001", json={"quantity": 1})
    assert update_response.status_code == 200
    assert update_response.json()["item_count"] == 1
    assert Decimal(update_response.json()["subtotal"]) == Decimal("39.7")

    remove_response = client.delete(f"/carts/{cart_id}/items/prod_001")
    assert remove_response.status_code == 200
    assert remove_response.json()["items"] == []
    assert Decimal(remove_response.json()["subtotal"]) == Decimal("0")


def test_cart_rejects_unavailable_product_with_agent_error() -> None:
    cart_id = create_cart()

    response = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_000", "quantity": 1})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "product_unavailable"


def test_cart_rejects_quantity_above_stock() -> None:
    cart_id = create_cart()

    response = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 41})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "insufficient_stock"


def test_cart_rejects_missing_price_product() -> None:
    cart_id = create_cart()

    response = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_null_001", "quantity": 1})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "product_missing_price"


def test_cart_update_and_remove_missing_item_return_agent_error() -> None:
    cart_id = create_cart()

    patch_response = client.patch(f"/carts/{cart_id}/items/prod_001", json={"quantity": 1})
    delete_response = client.delete(f"/carts/{cart_id}/items/prod_001")

    assert patch_response.status_code == 404
    assert patch_response.json()["error"]["code"] == "cart_item_not_found"
    assert delete_response.status_code == 404
    assert delete_response.json()["error"]["code"] == "cart_item_not_found"


def test_cart_patch_and_delete_preserve_remaining_summary() -> None:
    cart_id = create_cart()

    first_add = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 1})
    second_add = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_002", "quantity": 2})

    assert first_add.status_code == 200
    assert second_add.status_code == 200

    patch_response = client.patch(f"/carts/{cart_id}/items/prod_002", json={"quantity": 3})
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["item_count"] == 4
    assert Decimal(patched["subtotal"]) == Decimal("146.53")

    delete_response = client.delete(f"/carts/{cart_id}/items/prod_001")
    assert delete_response.status_code == 200
    deleted = delete_response.json()
    assert deleted["item_count"] == 3
    assert deleted["currency"] == "USD"
    assert Decimal(deleted["subtotal"]) == Decimal("106.83")
    assert [item["product_id"] for item in deleted["items"]] == ["prod_002"]
