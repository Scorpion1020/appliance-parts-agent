import math
import re
from dataclasses import dataclass

from app.catalog.models import CatalogItem
from app.catalog.search import OptionalEmbeddingSearch, SEMANTIC_TERM_MAP


RELATED_TERM_MAP = {
    "sweater": {"hoodie", "beanie", "jacket", "coat", "wool", "fleece", "merino", "cashmere", "winter", "warm"},
    "merino": {"sweater", "hoodie", "beanie", "jacket", "coat", "wool", "cashmere", "winter", "warm"},
    "cashmere": {"sweater", "hoodie", "beanie", "jacket", "coat", "wool", "merino", "winter", "warm"},
    "wool": {"sweater", "hoodie", "beanie", "jacket", "coat", "merino", "cashmere", "winter", "warm"},
    "hoodie": {"sweater", "beanie", "jacket", "coat", "wool", "fleece", "merino", "cashmere", "winter", "warm"},
    "tee": {"denim", "jeans", "chino", "chinos", "jacket", "sneaker", "sneakers"},
    "shirt": {"denim", "jeans", "chino", "chinos", "jacket", "sneaker", "sneakers"},
    "bag": {"travel", "accessories", "card", "holder", "belt", "sunglasses"},
    "candle": {"mug", "blanket", "home", "planter", "ceramic"},
}

RELATED_TERM_MAP.update(
    {
        "winter": SEMANTIC_TERM_MAP["winter"],
        "warm": SEMANTIC_TERM_MAP["warm"],
        "cold": SEMANTIC_TERM_MAP["cold"],
    }
)


@dataclass(frozen=True)
class RecommendationScore:
    product: CatalogItem
    score: float


class RecommendationEngine:
    def __init__(self, embedding_search: OptionalEmbeddingSearch | None = None, use_embeddings: bool = True) -> None:
        self.embedding_search = embedding_search or OptionalEmbeddingSearch()
        self.use_embeddings = use_embeddings

    def recommend_for_product(
        self,
        seed_product: CatalogItem,
        products: list[CatalogItem],
        limit: int = 10,
    ) -> list[CatalogItem]:
        seed_products = [seed_product]
        candidate_products = self._candidate_products(products, seed_products)
        embedding_scores = self._embedding_scores(seed_products, candidate_products)
        scored = [
            RecommendationScore(candidate, self._rule_score(seed_products, candidate) + embedding_scores.get(candidate.id, 0))
            for candidate in candidate_products
        ]
        return self._rank(scored, limit)

    def recommend_for_cart(
        self,
        seed_products: list[CatalogItem],
        products: list[CatalogItem],
        limit: int = 10,
    ) -> list[CatalogItem]:
        if not seed_products:
            return []
        candidate_products = self._candidate_products(products, seed_products)
        embedding_scores = self._embedding_scores(seed_products, candidate_products)
        scored = [
            RecommendationScore(candidate, self._rule_score(seed_products, candidate) + embedding_scores.get(candidate.id, 0))
            for candidate in candidate_products
        ]
        return self._rank(scored, limit)

    def _candidate_products(self, products: list[CatalogItem], seed_products: list[CatalogItem]) -> list[CatalogItem]:
        seed_ids = {product.id for product in seed_products}
        seed_markets = {product.market_id for product in seed_products}
        seed_languages = {product.language for product in seed_products}
        return [
            product
            for product in products
            if product.id not in seed_ids
            and product.available is True
            and product.market_id in seed_markets
            and product.language in seed_languages
        ]

    def _rule_score(self, seed_products: list[CatalogItem], candidate: CatalogItem) -> float:
        score = 0.0
        candidate_tokens = self._product_tokens(candidate)
        candidate_tags = set(candidate.tags)
        related_terms = set()

        for seed in seed_products:
            seed_tokens = self._product_tokens(seed)
            seed_tags = set(seed.tags)
            related_terms.update(self._related_terms(seed_tokens))

            score += len(seed_tags.intersection(candidate_tags)) * 20
            if seed.category and seed.category == candidate.category:
                score += 15
            if seed.type == candidate.type:
                score += 5

        score += len(related_terms.intersection(candidate_tokens)) * 30
        score += 20
        score += (candidate.rating or 0) * 5
        score += math.log1p(candidate.review_count or 0)
        return score

    def _related_terms(self, seed_tokens: set[str]) -> set[str]:
        related_terms = set()
        for token in seed_tokens:
            related_terms.update(RELATED_TERM_MAP.get(token, set()))
        return related_terms

    def _embedding_scores(self, seed_products: list[CatalogItem], candidate_products: list[CatalogItem]) -> dict[str, float]:
        if not self.use_embeddings or not seed_products or not candidate_products:
            return {}
        try:
            model = self.embedding_search._get_model()
            all_products = seed_products + candidate_products
            embeddings = self.embedding_search._get_product_embeddings(model, all_products)
            seed_vector = self._average_vectors([embeddings[product.id] for product in seed_products])
            return {
                candidate.id: similarity * self.embedding_search.weight
                for candidate in candidate_products
                if (similarity := self.embedding_search._cosine(seed_vector, embeddings[candidate.id]))
                >= self.embedding_search.min_similarity
            }
        except Exception:
            return {}

    def _average_vectors(self, vectors: list[list[float]]) -> list[float]:
        return [sum(values) / len(values) for values in zip(*vectors, strict=True)]

    def _rank(self, scored: list[RecommendationScore], limit: int) -> list[CatalogItem]:
        ranked = sorted(
            [item for item in scored if item.score > 0],
            key=lambda item: (
                -item.score,
                -(item.product.rating or 0),
                -(item.product.review_count or 0),
                item.product.name,
            ),
        )
        return [item.product for item in ranked[:limit]]

    def _product_tokens(self, product: CatalogItem) -> set[str]:
        text = " ".join(
            [
                product.name,
                product.category or "",
                product.description or "",
                " ".join(product.tags),
            ]
        )
        return set(re.findall(r"\w+", text.casefold()))
