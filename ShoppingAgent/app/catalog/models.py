from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CatalogItemType = Literal["product", "gift_card", "collection", "page", "bundle"]


class CatalogItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    type: CatalogItemType
    name: str
    market_id: str
    language: str
    category: str | None = None
    product_group_id: str | None = None
    price: Decimal | None = None
    currency: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    stock_qty: int | None = None
    available: bool | None = None
    rating: float | None = None
    review_count: int | None = None

    @field_validator("price", mode="before")
    @classmethod
    def normalize_price(cls, value: Any) -> Decimal | None:
        if value is None or value == "":
            return None
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError(f"Invalid price value: {value!r}") from exc

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return list(value)

    @property
    def is_product(self) -> bool:
        return self.type == "product"

    @property
    def is_purchasable_product(self) -> bool:
        return self.is_product and self.available is True and self.price is not None


class ProductSummary(BaseModel):
    id: str
    name: str
    category: str | None
    price: Decimal | None
    currency: str | None
    market_id: str
    language: str
    available: bool
    stock_qty: int | None
    rating: float | None
    review_count: int | None
    tags: list[str]
    manufacturer_part_number: str = ""
    brand: str = ""
    source_url: str = ""
    data_origin: str = "unknown"
    symptoms: list[str] = Field(default_factory=list)


class ProductDetails(ProductSummary):
    product_group_id: str | None
    description: str | None


class ProductSearchResponse(BaseModel):
    results: list[ProductSummary]
    total: int
    limit: int
    offset: int


class ProductRecommendationsResponse(BaseModel):
    seed_product_ids: list[str]
    results: list[ProductSummary]
    total: int
    limit: int
