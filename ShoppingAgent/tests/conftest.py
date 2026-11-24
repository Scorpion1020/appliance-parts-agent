import pytest

from app.cart.repository import CartRepository


@pytest.fixture(autouse=True)
def isolated_cart_database(tmp_path, monkeypatch):
    # 测试不能把演示用户的购物车写进真实数据库。
    repository = CartRepository(tmp_path / "carts.sqlite3")
    monkeypatch.setattr("app.cart.router.get_cart_repository", lambda: repository)
