from app.catalog.models import CatalogItem
from app.catalog.search import OptionalEmbeddingSearch, SearchScorer


def test_search_scorer_weights_name_category_and_description() -> None:
    scorer = SearchScorer()
    tokens = scorer.query_tokens("linen")
    name_match = CatalogItem(
        id="name_match",
        type="product",
        name="Linen Shirt",
        category="apparel",
        market_id="us",
        language="en",
        description="A summer layer.",
        available=True,
    )
    category_match = CatalogItem(
        id="category_match",
        type="product",
        name="Storage Basket",
        category="linen",
        market_id="us",
        language="en",
        description="A home organizer.",
        available=True,
    )
    description_match = CatalogItem(
        id="description_match",
        type="product",
        name="Beach Shirt",
        category="apparel",
        market_id="us",
        language="en",
        description="Made from linen.",
        available=True,
    )

    assert scorer.score(name_match, tokens).total > scorer.score(category_match, tokens).total
    assert scorer.score(category_match, tokens).total > scorer.score(description_match, tokens).total


class FailingEmbeddingSearch(OptionalEmbeddingSearch):
    def score_all(self, query, products):  # type: ignore[no-untyped-def]
        raise RuntimeError("embeddings unavailable")


def test_search_scorer_dictionary_fallback_works_when_embeddings_fail() -> None:
    scorer = SearchScorer(embedding_search=FailingEmbeddingSearch())
    query = scorer.prepare_query("something warm")
    product = CatalogItem(
        id="warm_match",
        type="product",
        name="Wool Beanie",
        category="accessories",
        market_id="us",
        language="en",
        description="Soft winter hat.",
        tags=["wool"],
        available=True,
    )
    embedding_scores = scorer.embedding_scores(query, [product])

    assert embedding_scores == {}
    assert scorer.matches(product, query, embedding_scores=embedding_scores)
    assert scorer.score(product, query, embedding_scores=embedding_scores).semantic_total > 0


def test_embedding_search_falls_back_to_empty_scores_on_failure() -> None:
    embedding_search = OptionalEmbeddingSearch()
    embedding_search._get_model = lambda: (_ for _ in ()).throw(RuntimeError("missing model"))  # type: ignore[method-assign]

    product = CatalogItem(
        id="warm_match",
        type="product",
        name="Cashmere Sweater",
        category="apparel",
        market_id="us",
        language="en",
        description="Warm knit.",
        tags=["cashmere"],
        available=True,
    )
    scores = embedding_search.score_all(SearchScorer().prepare_query("warm sweater"), [product])

    assert scores == {}
