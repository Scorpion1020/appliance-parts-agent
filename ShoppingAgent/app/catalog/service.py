from decimal import Decimal

from fastapi import status

from app.catalog.attributes import AttributeClassifier
from app.catalog.models import CatalogItem, ProductDetails, ProductSearchResponse, ProductSummary
from app.catalog.models import ProductRecommendationsResponse
from app.catalog.recommendations import RecommendationEngine
from app.catalog.repository import CatalogRepository
from app.catalog.search import SearchQuery, SearchScorer
from app.shared.errors import AgentToolError


class CatalogService:
    def __init__(
        self,
        repository: CatalogRepository,
        search_scorer: SearchScorer | None = None,
        attribute_classifier: AttributeClassifier | None = None,
        recommendation_engine: RecommendationEngine | None = None,
    ) -> None:
        self.repository = repository
        self.search_scorer = search_scorer or SearchScorer()
        self.attribute_classifier = attribute_classifier or AttributeClassifier()
        self.recommendation_engine = recommendation_engine or RecommendationEngine()

    def search_products(
        self,
        q: str | None = None,
        category: str | None = None,
        market_id: str | None = None,
        language: str | None = None,
        color: str | None = None,
        size: str | None = None,
        brand: str | None = None,
        available_only: bool = True,
        min_price: Decimal | None = None,
        max_price: Decimal | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> ProductSearchResponse:
        products = self.repository.list_products()
        query = self.search_scorer.prepare_query(q)
        normalized_color = self._normalize_attribute("color", color)
        normalized_size = self._normalize_attribute("size", size)
        normalized_brand = self._normalize_attribute("brand", brand)

        candidates = []
        for product in products:
            if category and (product.category or "").casefold() != category.casefold():
                continue
            if market_id and product.market_id.casefold() != market_id.casefold():
                continue
            if language and product.language.casefold() != language.casefold():
                continue
            if available_only and product.available is not True:
                continue
            if min_price is not None and (product.price is None or product.price < min_price):
                continue
            if max_price is not None and (product.price is None or product.price > max_price):
                continue
            if not self.attribute_classifier.matches(
                product,
                color=normalized_color,
                size=normalized_size,
                brand=normalized_brand,
            ):
                continue
            candidates.append(product)

        embedding_scores = self.search_scorer.embedding_scores(query, candidates)
        matched = [
            product
            for product in candidates
            if self.search_scorer.matches(product, query, embedding_scores)
        ]
        ranked = sorted(matched, key=lambda product: self._rank_key(product, query, embedding_scores))
        page = ranked[offset : offset + limit]
        return ProductSearchResponse(
            results=[self.to_summary(product) for product in page],
            total=len(ranked),
            limit=limit,
            offset=offset,
        )

    def get_product_details(self, product_id: str) -> ProductDetails:
        product = self.repository.get_product(product_id)
        if product is None:
            raise AgentToolError(
                code="product_not_found",
                message="Product was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"product_id": product_id},
            )
        return self.to_details(product)

    def require_purchasable_product(self, product_id: str) -> CatalogItem:
        product = self.repository.get_product(product_id)
        if product is None:
            raise AgentToolError(
                code="product_not_found",
                message="Product was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"product_id": product_id},
            )
        if product.available is not True:
            raise AgentToolError(
                code="product_unavailable",
                message="Product is not available.",
                details={"product_id": product_id},
            )
        if product.price is None:
            raise AgentToolError(
                code="product_missing_price",
                message="Product cannot be added to cart because it does not have a numeric price.",
                details={"product_id": product_id},
            )
        return product

    def to_summary(self, product: CatalogItem) -> ProductSummary:
        return ProductSummary(
            id=product.id,
            name=product.name,
            category=product.category,
            price=product.price,
            currency=product.currency,
            market_id=product.market_id,
            language=product.language,
            available=product.available is True,
            stock_qty=product.stock_qty,
            rating=product.rating,
            review_count=product.review_count,
            tags=product.tags,
            manufacturer_part_number=getattr(product, "manufacturer_part_number", ""),
            brand=getattr(product, "brand", ""),
            source_url=getattr(product, "source_url", ""),
            data_origin=getattr(product, "data_origin", "unknown"),
            symptoms=getattr(product, "symptoms", []),
        )

    def to_details(self, product: CatalogItem) -> ProductDetails:
        return ProductDetails(
            **self.to_summary(product).model_dump(),
            product_group_id=product.product_group_id,
            description=product.description,
        )

    def recommend_for_product(self, product_id: str, limit: int = 10) -> ProductRecommendationsResponse:
        seed_product = self.repository.get_product(product_id)
        if seed_product is None:
            raise AgentToolError(
                code="product_not_found",
                message="Product was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"product_id": product_id},
            )
        recommendations = self.recommendation_engine.recommend_for_product(
            seed_product,
            self.repository.list_products(),
            limit=limit,
        )
        return ProductRecommendationsResponse(
            seed_product_ids=[seed_product.id],
            results=[self.to_summary(product) for product in recommendations],
            total=len(recommendations),
            limit=limit,
        )

    def recommend_for_products(self, product_ids: list[str], limit: int = 10) -> ProductRecommendationsResponse:
        seed_products = [
            product
            for product_id in product_ids
            if (product := self.repository.get_product(product_id)) is not None
        ]
        recommendations = self.recommendation_engine.recommend_for_cart(
            seed_products,
            self.repository.list_products(),
            limit=limit,
        )
        return ProductRecommendationsResponse(
            seed_product_ids=[product.id for product in seed_products],
            results=[self.to_summary(product) for product in recommendations],
            total=len(recommendations),
            limit=limit,
        )

    def _normalize_attribute(self, attribute: str, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        try:
            if attribute == "color":
                return self.attribute_classifier.normalize_color(value)
            if attribute == "size":
                return self.attribute_classifier.normalize_size(value)
            if attribute == "brand":
                return self.attribute_classifier.normalize_brand(value)
        except ValueError as exc:
            raise AgentToolError(
                code="invalid_filter_value",
                message=f"Unsupported {attribute} filter value.",
                status_code=status.HTTP_400_BAD_REQUEST,
                details={"attribute": attribute, "value": value},
            ) from exc
        return value

    def _rank_key(
        self,
        product: CatalogItem,
        query: SearchQuery,
        embedding_scores: dict[str, float],
    ) -> tuple[float, float, int, str]:
        relevance = self.search_scorer.score(product, query, embedding_scores).total
        return (
            -relevance,
            -(product.rating or 0),
            -(product.review_count or 0),
            product.name,
        )
