from fastapi.testclient import TestClient

from app.catalog.recommendations import RecommendationEngine
from app.catalog.router import get_catalog_repository
from app.catalog.search import OptionalEmbeddingSearch
from app.main import app


client = TestClient(app)


class FailingRecommendationEmbeddings(OptionalEmbeddingSearch):
    def _get_model(self):  # type: ignore[no-untyped-def]
        raise RuntimeError("embedding model unavailable")


def test_product_recommendations_include_related_warm_products_and_exclude_seed() -> None:
    response = client.get("/products/prod_010/recommendations", params={"limit": 8})

    assert response.status_code == 200
    body = response.json()
    result_ids = {result["id"] for result in body["results"]}
    assert "prod_010" not in result_ids
    assert result_ids.intersection({"prod_011", "prod_uni_003", "prod_028", "prod_005", "prod_006", "prod_007"})
    assert all(result["available"] for result in body["results"])


def test_recommendation_fallback_works_without_embedding_dependencies() -> None:
    repository = get_catalog_repository()
    engine = RecommendationEngine(
        embedding_search=FailingRecommendationEmbeddings(),
        use_embeddings=True,
    )
    seed = repository.get_product("prod_010")

    assert seed is not None
    recommendations = engine.recommend_for_product(seed, repository.list_products(), limit=5)
    result_ids = {product.id for product in recommendations}
    assert "prod_010" not in result_ids
    assert result_ids.intersection({"prod_011", "prod_uni_003", "prod_028"})


def test_recommendations_can_disable_embeddings() -> None:
    repository = get_catalog_repository()
    engine = RecommendationEngine(
        embedding_search=FailingRecommendationEmbeddings(),
        use_embeddings=False,
    )
    seed = repository.get_product("prod_uni_003")

    assert seed is not None
    recommendations = engine.recommend_for_product(seed, repository.list_products(), limit=5)
    assert recommendations
    assert all(product.id != "prod_uni_003" for product in recommendations)


def test_cart_recommendations_exclude_products_already_in_cart() -> None:
    cart_response = client.post("/carts")
    cart_id = cart_response.json()["id"]
    add_response = client.post(f"/carts/{cart_id}/items", json={"product_id": "prod_001", "quantity": 1})

    assert add_response.status_code == 200
    response = client.get(f"/carts/{cart_id}/recommendations", params={"limit": 8})

    assert response.status_code == 200
    result_ids = {result["id"] for result in response.json()["results"]}
    assert "prod_001" not in result_ids
    assert result_ids.intersection({"prod_018", "prod_019", "prod_016", "prod_017", "prod_021", "prod_022"})
