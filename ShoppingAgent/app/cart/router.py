from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, status
from app.config import get_settings
from app.shared.errors import AgentToolError

from app.cart.models import CartItemRequest, CartItemUpdateRequest, CartResponse
from app.cart.repository import CartRepository
from app.cart.service import CartService
from app.catalog.models import ProductRecommendationsResponse
from app.catalog.router import get_catalog_service
from app.catalog.service import CatalogService

router = APIRouter(prefix="/carts", tags=["carts"])
OperationKey = Annotated[str | None, Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


def get_turn_lease(
    request_id: Annotated[str | None, Header(alias="X-Conversation-Request")] = None,
    token: Annotated[str | None, Header(alias="X-Conversation-Token")] = None,
):
    if (request_id is None) != (token is None):
        raise AgentToolError("invalid_turn_lease", "Both conversation request and token are required.")
    return (request_id, token) if request_id is not None else None


@lru_cache
def get_cart_repository() -> CartRepository:
    return CartRepository(get_settings().cart_database_path)


def get_cart_service(catalog_service: CatalogService = Depends(get_catalog_service)) -> CartService:
    return CartService(get_cart_repository(), catalog_service)


@router.post("", response_model=CartResponse, status_code=status.HTTP_201_CREATED)
def create_cart(service: CartService = Depends(get_cart_service)) -> CartResponse:
    return service.create_cart()


@router.get("/{cart_id}", response_model=CartResponse)
def get_cart(cart_id: str, service: CartService = Depends(get_cart_service)) -> CartResponse:
    return service.get_cart(cart_id)


@router.post("/{cart_id}/items", response_model=CartResponse)
def add_item(cart_id: str, request: CartItemRequest, operation_key: OperationKey = None, service: CartService = Depends(get_cart_service), turn_lease=Depends(get_turn_lease)) -> CartResponse:
    return service.add_item(cart_id, request.product_id, request.quantity, operation_key, turn_lease)


@router.patch("/{cart_id}/items/{product_id}", response_model=CartResponse)
def update_item(
    cart_id: str,
    product_id: str,
    request: CartItemUpdateRequest,
    operation_key: OperationKey = None,
    service: CartService = Depends(get_cart_service),
    turn_lease=Depends(get_turn_lease),
) -> CartResponse:
    return service.update_item(cart_id, product_id, request.quantity, operation_key, turn_lease)


@router.delete("/{cart_id}/items/{product_id}", response_model=CartResponse)
def remove_item(cart_id: str, product_id: str, operation_key: OperationKey = None, service: CartService = Depends(get_cart_service), turn_lease=Depends(get_turn_lease)) -> CartResponse:
    return service.remove_item(cart_id, product_id, operation_key, turn_lease)


@router.get("/{cart_id}/recommendations", response_model=ProductRecommendationsResponse)
def get_cart_recommendations(
    cart_id: str,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    service: CartService = Depends(get_cart_service),
) -> ProductRecommendationsResponse:
    return service.recommend_for_cart(cart_id, limit=limit)
