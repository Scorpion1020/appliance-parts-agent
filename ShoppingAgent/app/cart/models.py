from decimal import Decimal
from uuid import uuid4

from pydantic import BaseModel, Field


class CartItem(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class Cart(BaseModel):
    id: str = Field(default_factory=lambda: f"cart_{uuid4().hex}")
    items: dict[str, CartItem] = Field(default_factory=dict)


class CartItemRequest(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class CartItemUpdateRequest(BaseModel):
    quantity: int = Field(gt=0)


class CartLineResponse(BaseModel):
    product_id: str
    name: str
    quantity: int
    unit_price: Decimal | None
    line_total: Decimal | None
    currency: str
    available: bool
    stock_qty: int | None


class CartResponse(BaseModel):
    id: str
    items: list[CartLineResponse]
    item_count: int
    subtotal: Decimal
    currency: str | None
