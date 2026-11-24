from decimal import Decimal
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.catalog.models import ProductDetails, ProductRecommendationsResponse, ProductSearchResponse
from app.catalog.repository import CatalogRepository
from app.catalog.service import CatalogService
from app.config import get_settings

router = APIRouter(prefix="/products", tags=["products"])


@lru_cache
def get_catalog_repository() -> CatalogRepository:
    return CatalogRepository(get_settings().catalog_path)


def get_catalog_service() -> CatalogService:
    return CatalogService(get_catalog_repository())


@router.get("/search", response_model=ProductSearchResponse)
def search_products(
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
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    service: CatalogService = Depends(get_catalog_service),
) -> ProductSearchResponse:
    return service.search_products(
        q=q,
        category=category,
        market_id=market_id,
        language=language,
        color=color,
        size=size,
        brand=brand,
        available_only=available_only,
        min_price=min_price,
        max_price=max_price,
        limit=limit,
        offset=offset,
    )


@router.get("/{product_id}", response_model=ProductDetails)
def get_product(product_id: str, service: CatalogService = Depends(get_catalog_service)) -> ProductDetails:
    return service.get_product_details(product_id)


@router.get("/{product_id}/recommendations", response_model=ProductRecommendationsResponse)
def get_product_recommendations(
    product_id: str,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    service: CatalogService = Depends(get_catalog_service),
) -> ProductRecommendationsResponse:
    return service.recommend_for_product(product_id, limit=limit)
