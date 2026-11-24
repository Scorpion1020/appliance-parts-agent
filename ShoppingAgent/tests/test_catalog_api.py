from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_search_products_returns_available_matches() -> None:
    response = client.get("/products/search", params={"q": "tee", "market_id": "us"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 0
    assert body["results"]
    assert all(result["available"] for result in body["results"])
    assert all(result["market_id"] == "us" for result in body["results"])


def test_search_normalizes_string_prices() -> None:
    response = client.get("/products/search", params={"q": "Heritage Denim Jacket"})

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["id"] == "prod_str_001"
    assert result["price"] == "129.00"


def test_search_matches_query_tokens_and_ranks_name_hits_first() -> None:
    response = client.get("/products/search", params={"q": "black hoodie", "market_id": "us"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 0
    assert body["results"][0]["name"] == "Heavyweight Hoodie - Black"


def test_exact_search_still_works_for_white_tee() -> None:
    response = client.get("/products/search", params={"q": "white tee", "market_id": "us"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 0
    assert any(result["id"] in {"prod_001", "prod_dupe_a", "prod_dupe_c"} for result in body["results"])


def test_semantic_search_returns_warm_products_for_winter() -> None:
    response = client.get("/products/search", params={"q": "winter", "market_id": "us"})

    assert response.status_code == 200
    result_ids = {result["id"] for result in response.json()["results"]}
    assert result_ids.intersection({"prod_005", "prod_006", "prod_007", "prod_010", "prod_011", "prod_028", "prod_str_001", "prod_stock_001", "prod_uni_003"})


def test_semantic_search_ignores_stopwords() -> None:
    response = client.get("/products/search", params={"q": "i need sweater for winter", "market_id": "us"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 0
    assert body["results"][0]["id"] in {"prod_010", "prod_011", "prod_uni_003"}


def test_semantic_search_handles_cold_weather_phrase() -> None:
    response = client.get("/products/search", params={"q": "cold weather clothes", "market_id": "us"})

    assert response.status_code == 200
    result_ids = {result["id"] for result in response.json()["results"]}
    assert result_ids.intersection({"prod_005", "prod_006", "prod_007", "prod_010", "prod_011", "prod_028", "prod_014", "prod_015"})


def test_search_ranks_name_matches_above_description_matches() -> None:
    response = client.get("/products/search", params={"q": "brown", "market_id": "us"})

    assert response.status_code == 200
    result_ids = [result["id"] for result in response.json()["results"]]
    assert "prod_uni_001" in result_ids
    assert result_ids.index("prod_030") < result_ids.index("prod_uni_001")


def test_search_filters_by_classified_color() -> None:
    response = client.get("/products/search", params={"q": "hoodie", "color": "black", "market_id": "us"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["results"][0]["id"] == "prod_005"


def test_search_rejects_unknown_attribute_filter_value() -> None:
    response = client.get("/products/search", params={"q": "hoodie", "color": "plaid"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_filter_value"


def test_search_accepts_all_filter_parameters() -> None:
    response = client.get(
        "/products/search",
        params={
            "q": "black hoodie",
            "category": "apparel",
            "market_id": "us",
            "language": "en",
            "color": "black",
            "available_only": True,
            "min_price": "30",
            "max_price": "45",
            "limit": 5,
            "offset": 0,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["limit"] == 5
    assert body["offset"] == 0
    result = body["results"][0]
    assert result["name"] == "Heavyweight Hoodie - Black"
    assert result["category"] == "apparel"
    assert result["market_id"] == "us"
    assert result["language"] == "en"
    assert result["available"] is True


def test_get_product_details_not_found_is_agent_friendly() -> None:
    response = client.get("/products/not-real")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "product_not_found"
