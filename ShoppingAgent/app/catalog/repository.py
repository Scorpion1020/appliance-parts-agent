import json
from pathlib import Path

from app.catalog.models import CatalogItem
from app.shared.errors import AgentToolError


class CatalogRepository:
    def __init__(self, catalog_path: Path) -> None:
        self.catalog_path = catalog_path
        self._items = self._load_items(catalog_path)
        self._items_by_id = {item.id: item for item in self._items}

    def _load_items(self, catalog_path: Path) -> list[CatalogItem]:
        if not catalog_path.exists():
            raise AgentToolError(
                code="catalog_not_found",
                message="Catalog file could not be found.",
                status_code=500,
                details={"catalog_path": str(catalog_path)},
            )

        with catalog_path.open("r", encoding="utf-8") as file:
            raw_items = json.load(file)

        return [CatalogItem.model_validate(item) for item in raw_items]

    def get_item(self, item_id: str) -> CatalogItem | None:
        return self._items_by_id.get(item_id)

    def get_product(self, product_id: str) -> CatalogItem | None:
        item = self.get_item(product_id)
        if item is None or not item.is_product:
            return None
        return item

    def list_products(self) -> list[CatalogItem]:
        return [item for item in self._items if item.is_product]
