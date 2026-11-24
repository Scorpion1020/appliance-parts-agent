from decimal import Decimal
import json

from fastapi import status

from app.cart.models import Cart, CartItem, CartLineResponse, CartResponse
from app.cart.repository import CartRepository
from app.catalog.models import CatalogItem
from app.catalog.models import ProductRecommendationsResponse
from app.catalog.service import CatalogService
from app.shared.errors import AgentToolError


class CartService:
    def __init__(self, cart_repository: CartRepository, catalog_service: CatalogService) -> None:
        self.cart_repository = cart_repository
        self.catalog_service = catalog_service

    def create_cart(self) -> CartResponse:
        return self.to_response(self.cart_repository.create())

    def get_cart(self, cart_id: str) -> CartResponse:
        return self.to_response(self.require_cart(cart_id))

    def add_item(self, cart_id: str, product_id: str, quantity: int, operation_key: str | None = None, turn_lease: tuple[str, str] | None = None) -> CartResponse:
        def operation(cart: Cart) -> CartResponse:
            product = self.catalog_service.require_purchasable_product(product_id)
            existing_quantity = cart.items.get(product_id).quantity if product_id in cart.items else 0
            new_quantity = existing_quantity + quantity
            self.validate_quantity(product, new_quantity)
            self.validate_currency(cart, product)
            cart.items[product_id] = CartItem(product_id=product_id, quantity=new_quantity)
            return self.to_response(cart)

        return self.cart_repository.mutate(cart_id, operation_key, json.dumps(["add", product_id, quantity]), operation, turn_lease)

    def update_item(self, cart_id: str, product_id: str, quantity: int, operation_key: str | None = None, turn_lease: tuple[str, str] | None = None) -> CartResponse:
        def operation(cart: Cart) -> CartResponse:
            self.require_item(cart, product_id)
            product = self.catalog_service.require_purchasable_product(product_id)
            self.validate_quantity(product, quantity)
            cart.items[product_id] = CartItem(product_id=product_id, quantity=quantity)
            return self.to_response(cart)

        return self.cart_repository.mutate(cart_id, operation_key, json.dumps(["update", product_id, quantity]), operation, turn_lease)

    def remove_item(self, cart_id: str, product_id: str, operation_key: str | None = None, turn_lease: tuple[str, str] | None = None) -> CartResponse:
        def operation(cart: Cart) -> CartResponse:
            self.require_item(cart, product_id)
            del cart.items[product_id]
            return self.to_response(cart)

        return self.cart_repository.mutate(cart_id, operation_key, json.dumps(["remove", product_id]), operation, turn_lease)

    def require_item(self, cart: Cart, product_id: str) -> None:
        if product_id not in cart.items:
            raise AgentToolError(
                code="cart_item_not_found",
                message="Product is not in the cart.",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"cart_id": cart.id, "product_id": product_id},
            )

    def recommend_for_cart(self, cart_id: str, limit: int = 10) -> ProductRecommendationsResponse:
        cart = self.require_cart(cart_id)
        return self.catalog_service.recommend_for_products(list(cart.items.keys()), limit=limit)

    def require_cart(self, cart_id: str) -> Cart:
        cart = self.cart_repository.get(cart_id)
        if cart is None:
            raise AgentToolError(
                code="cart_not_found",
                message="Cart was not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                details={"cart_id": cart_id},
            )
        return cart

    def validate_quantity(self, product: CatalogItem, quantity: int) -> None:
        if product.stock_qty is not None and quantity > product.stock_qty:
            raise AgentToolError(
                code="insufficient_stock",
                message="Requested quantity exceeds available stock.",
                details={
                    "product_id": product.id,
                    "requested_quantity": quantity,
                    "stock_qty": product.stock_qty,
                },
            )

    def validate_currency(self, cart: Cart, product: CatalogItem) -> None:
        currency = self.cart_currency(cart)
        if currency and product.currency and currency != product.currency:
            raise AgentToolError(
                code="mixed_currency_cart",
                message="Cart items must use the same currency.",
                details={"cart_currency": currency, "product_currency": product.currency},
            )

    def cart_currency(self, cart: Cart) -> str | None:
        for item in cart.items.values():
            product = self.catalog_service.repository.get_product(item.product_id)
            if product and product.currency:
                return product.currency
        return None

    def to_response(self, cart: Cart) -> CartResponse:
        lines: list[CartLineResponse] = []
        subtotal = Decimal("0")
        currency: str | None = None

        for item in cart.items.values():
            product = self.catalog_service.repository.get_product(item.product_id)
            available = bool(product and product.available is True and product.price is not None
                and (product.stock_qty is None or product.stock_qty >= item.quantity))
            unit_price = product.price if product else None
            line_total = unit_price * item.quantity if unit_price is not None else None
            if available and line_total is not None:
                subtotal += line_total
            currency = currency or (product.currency if product else None)
            lines.append(
                CartLineResponse(
                    product_id=item.product_id,
                    name=product.name if product else item.product_id,
                    quantity=item.quantity,
                    unit_price=unit_price,
                    line_total=line_total,
                    currency=(product.currency or "") if product else "",
                    available=available,
                    stock_qty=product.stock_qty if product else None,
                )
            )

        return CartResponse(
            id=cart.id,
            items=lines,
            item_count=sum(item.quantity for item in cart.items.values()),
            subtotal=subtotal,
            currency=currency,
        )
