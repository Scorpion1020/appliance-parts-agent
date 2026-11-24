import json
import math
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.catalog.models import CatalogItem


STOPWORDS = {
    "i",
    "need",
    "want",
    "looking",
    "for",
    "a",
    "an",
    "the",
    "some",
    "something",
    "me",
    "show",
    "find",
    "please",
}

SEMANTIC_TERM_MAP = {
    "winter": {"sweater", "hoodie", "beanie", "flannel", "overshirt", "jacket", "coat", "fleece", "cashmere", "down", "wool", "merino"},
    "cold": {"sweater", "hoodie", "beanie", "flannel", "overshirt", "jacket", "coat", "fleece", "cashmere", "down", "wool", "merino"},
    "weather": {"sweater", "hoodie", "beanie", "flannel", "overshirt", "jacket", "coat", "fleece", "cashmere", "down", "wool", "merino"},
    "warm": {"sweater", "hoodie", "beanie", "flannel", "overshirt", "jacket", "coat", "fleece", "cashmere", "down", "wool", "merino"},
    "cozy": {"sweater", "hoodie", "beanie", "flannel", "overshirt", "cashmere", "wool", "merino"},
    "sweater": {"sweater", "cashmere", "merino", "wool"},
}


@dataclass(frozen=True)
class SearchField:
    name: str
    weight: int
    value: Callable[[CatalogItem], str | list[str] | None]


@dataclass(frozen=True)
class SearchQuery:
    raw: str | None
    tokens: list[str]
    semantic_terms: set[str]

    @property
    def has_terms(self) -> bool:
        return bool(self.tokens or self.semantic_terms)


@dataclass(frozen=True)
class SearchScore:
    total: float
    exact_total: int
    semantic_total: int
    embedding_total: float
    matched_tokens: set[str]
    matched_semantic_terms: set[str]


class OptionalEmbeddingSearch:
    def __init__(
        self,
        cache_path: Path = Path("data/catalog_embeddings.json"),
        model_name: str = "all-MiniLM-L6-v2",
        min_similarity: float = 0.35,
        weight: int = 75,
    ) -> None:
        self.cache_path = cache_path
        self.model_name = model_name
        self.min_similarity = min_similarity
        self.weight = weight
        self._model: Any | None = None

    def score_all(self, query: SearchQuery, products: list[CatalogItem]) -> dict[str, float]:
        if not query.raw or not products:
            return {}
        try:
            model = self._get_model()
            product_embeddings = self._get_product_embeddings(model, products)
            query_embedding = model.encode([query.raw], normalize_embeddings=True)[0]
            return {
                product.id: similarity * self.weight
                for product in products
                if (similarity := self._cosine(query_embedding, product_embeddings[product.id])) >= self.min_similarity
            }
        except Exception:
            return {}

    def _get_model(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def _get_product_embeddings(self, model: Any, products: list[CatalogItem]) -> dict[str, list[float]]:
        cached = self._read_cache()
        expected_ids = {product.id for product in products}
        if cached.get("model_name") == self.model_name and expected_ids.issubset(cached.get("embeddings", {})):
            return {product_id: cached["embeddings"][product_id] for product_id in expected_ids}

        embeddings = model.encode(
            [self.product_embedding_text(product) for product in products],
            normalize_embeddings=True,
        )
        product_embeddings = {
            product.id: [float(value) for value in embedding]
            for product, embedding in zip(products, embeddings, strict=True)
        }
        self._write_cache(product_embeddings)
        return product_embeddings

    def product_embedding_text(self, product: CatalogItem) -> str:
        return " ".join(
            [
                product.name,
                product.category or "",
                product.description or "",
                " ".join(product.tags),
            ]
        )

    def _read_cache(self) -> dict[str, Any]:
        if not self.cache_path.exists():
            return {}
        with self.cache_path.open("r", encoding="utf-8") as file:
            return json.load(file)

    def _write_cache(self, embeddings: dict[str, list[float]]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with self.cache_path.open("w", encoding="utf-8") as file:
            json.dump({"model_name": self.model_name, "embeddings": embeddings}, file)

    def _cosine(self, left: Any, right: list[float]) -> float:
        left_values = [float(value) for value in left]
        numerator = sum(a * b for a, b in zip(left_values, right, strict=True))
        left_norm = math.sqrt(sum(value * value for value in left_values))
        right_norm = math.sqrt(sum(value * value for value in right))
        if left_norm == 0 or right_norm == 0:
            return 0
        return numerator / (left_norm * right_norm)


class SearchScorer:
    def __init__(
        self,
        fields: list[SearchField] | None = None,
        embedding_search: OptionalEmbeddingSearch | None = None,
    ) -> None:
        self.fields = fields or [
            SearchField("name", 100, lambda product: product.name),
            SearchField("category", 50, lambda product: product.category),
            SearchField("description", 20, lambda product: product.description),
            SearchField("tags", 10, lambda product: product.tags),
        ]
        # 可选模型必须显式启用，避免一次普通查询意外触发模型下载。
        self.embedding_search = embedding_search or (OptionalEmbeddingSearch() if os.getenv("SHOPPING_AGENT_ENABLE_EMBEDDINGS") == "1" else None)

    def prepare_query(self, query: str | None) -> SearchQuery:
        tokens = [token for token in self._tokens(query or "") if token not in STOPWORDS]
        semantic_terms = set()
        for token in tokens:
            semantic_terms.update(SEMANTIC_TERM_MAP.get(token, set()))
        return SearchQuery(raw=query, tokens=tokens, semantic_terms=semantic_terms)

    def query_tokens(self, query: str | None) -> list[str]:
        return self.prepare_query(query).tokens

    def score(
        self,
        product: CatalogItem,
        query: SearchQuery | list[str],
        embedding_scores: dict[str, float] | None = None,
    ) -> SearchScore:
        prepared_query = query if isinstance(query, SearchQuery) else SearchQuery(raw=None, tokens=query, semantic_terms=set())
        exact_total, matched_tokens = self._exact_score(product, prepared_query.tokens)
        semantic_total, matched_semantic_terms = self._semantic_score(product, prepared_query.semantic_terms)
        embedding_total = (embedding_scores or {}).get(product.id, 0)
        return SearchScore(
            total=exact_total + semantic_total + embedding_total,
            exact_total=exact_total,
            semantic_total=semantic_total,
            embedding_total=embedding_total,
            matched_tokens=matched_tokens,
            matched_semantic_terms=matched_semantic_terms,
        )

    def embedding_scores(self, query: SearchQuery, products: list[CatalogItem]) -> dict[str, float]:
        if self.embedding_search is None:
            return {}
        try:
            return self.embedding_search.score_all(query, products)
        except Exception:
            return {}

    def matches(self, product: CatalogItem, query: SearchQuery, embedding_scores: dict[str, float] | None = None) -> bool:
        if not query.has_terms:
            return True
        score = self.score(product, query, embedding_scores)
        exact_query_matched = bool(query.tokens) and set(query.tokens).issubset(score.matched_tokens)
        semantic_query_matched = bool(query.semantic_terms) and bool(score.matched_semantic_terms)
        embedding_query_matched = bool(query.semantic_terms) and score.embedding_total > 0
        return exact_query_matched or semantic_query_matched or embedding_query_matched

    def matches_all_tokens(self, product: CatalogItem, tokens: list[str]) -> bool:
        if not tokens:
            return True
        return set(tokens).issubset(self.score(product, tokens).matched_tokens)

    def _exact_score(self, product: CatalogItem, tokens: list[str]) -> tuple[int, set[str]]:
        total = 0
        matched_tokens: set[str] = set()

        for token in tokens:
            for field in self.fields:
                if token in self._field_tokens(field.value(product)):
                    total += field.weight
                    matched_tokens.add(token)

        return total, matched_tokens

    def _semantic_score(self, product: CatalogItem, semantic_terms: set[str]) -> tuple[int, set[str]]:
        if not semantic_terms:
            return 0, set()
        product_tokens = self._field_tokens(self._product_text(product))
        matched_terms = semantic_terms.intersection(product_tokens)
        return len(matched_terms) * 40, matched_terms

    def _field_tokens(self, value: str | list[str] | None) -> set[str]:
        if value is None:
            return set()
        if isinstance(value, list):
            value = " ".join(value)
        return set(self._tokens(value))

    def _product_text(self, product: CatalogItem) -> str:
        return " ".join(
            [
                product.name,
                product.category or "",
                product.description or "",
                " ".join(product.tags),
            ]
        )

    def _tokens(self, value: str) -> list[str]:
        return re.findall(r"\w+", value.casefold())
