from decimal import Decimal

from fastapi.testclient import TestClient

from app.catalog.repository import CatalogRepository
from app.catalog.router import get_catalog_service
from app.catalog.service import CatalogService
from app.config import PROJECT_ROOT
from app.main import app


def test_exported_parts_catalog_supports_search_and_cart() -> None:
    repository = CatalogRepository(PROJECT_ROOT / "data/parts-catalog.json")
    app.dependency_overrides[get_catalog_service] = lambda: CatalogService(repository)
    try:
        with TestClient(app) as client:
            search = client.get("/products/search", params={"q": "PS11752778"})
            assert search.status_code == 200
            assert "PS11752778" in [item["id"] for item in search.json()["results"]]

            product = client.get("/products/PS11752778").json()
            cart_id = client.post("/carts").json()["id"]
            for quantity in (1, 2):
                response = client.post(f"/carts/{cart_id}/items", json={"product_id": product["id"], "quantity": 1})
                assert response.status_code == 200
                assert response.json()["item_count"] == quantity
                assert Decimal(response.json()["subtotal"]) == Decimal(product["price"]) * quantity

            missing = client.post(f"/carts/{cart_id}/items", json={"product_id": "PS99999999", "quantity": 1})
            assert missing.status_code == 404
            assert client.get(f"/carts/{cart_id}").json()["item_count"] == 2

            removed = client.delete(f"/carts/{cart_id}/items/{product['id']}")
            assert removed.status_code == 200
            assert removed.json()["items"] == []
    finally:
        app.dependency_overrides.pop(get_catalog_service, None)
