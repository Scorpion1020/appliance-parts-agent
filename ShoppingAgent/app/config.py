from functools import lru_cache
import os
from pathlib import Path

from pydantic import BaseModel

PROJECT_ROOT = Path(__file__).resolve().parent.parent

class Settings(BaseModel):
    cart_database_path: Path = Path(os.getenv("SHOPPING_AGENT_CART_DB", str(PROJECT_ROOT / "data/carts.sqlite3")))
    catalog_path: Path = Path(os.getenv("SHOPPING_AGENT_CATALOG_PATH", str(PROJECT_ROOT / "data/catalog.json")))


@lru_cache
def get_settings() -> Settings:
    return Settings()
