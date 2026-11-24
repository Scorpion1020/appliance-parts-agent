from collections.abc import Callable
from contextlib import closing
from pathlib import Path
import sqlite3
import time

from app.cart.models import Cart, CartResponse
from app.shared.errors import AgentToolError


class CartRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as connection, connection:
            connection.execute("CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            connection.execute("""CREATE TABLE IF NOT EXISTS cart_operations (
                cart_id TEXT NOT NULL, operation_key TEXT NOT NULL,
                fingerprint TEXT NOT NULL, response TEXT NOT NULL,
                PRIMARY KEY (cart_id, operation_key)
            )""")
            connection.execute("CREATE TABLE IF NOT EXISTS conversations (cart_id TEXT PRIMARY KEY, memory TEXT NOT NULL, version INTEGER NOT NULL)")
            connection.execute("""CREATE TABLE IF NOT EXISTS conversation_turns (
                cart_id TEXT NOT NULL, request_id TEXT NOT NULL, message TEXT NOT NULL,
                status TEXT NOT NULL, token TEXT NOT NULL, expires_at REAL NOT NULL,
                started_at REAL NOT NULL, response TEXT, error TEXT,
                PRIMARY KEY (cart_id, request_id)
            )""")
            connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_running_turn ON conversation_turns(cart_id) WHERE status = 'running'")
            connection.execute("""CREATE TABLE IF NOT EXISTS turn_feedback (
                cart_id TEXT NOT NULL, request_id TEXT NOT NULL,
                rating TEXT NOT NULL, reason TEXT, comment TEXT,
                created_at REAL NOT NULL,
                PRIMARY KEY (cart_id, request_id)
            )""")

    def connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path, timeout=10)

    def create(self) -> Cart:
        cart = Cart()
        with closing(self.connect()) as connection, connection:
            connection.execute("INSERT INTO carts VALUES (?, ?)", (cart.id, cart.model_dump_json()))
        return cart

    def get(self, cart_id: str) -> Cart | None:
        with closing(self.connect()) as connection:
            row = connection.execute("SELECT payload FROM carts WHERE id = ?", (cart_id,)).fetchone()
        return Cart.model_validate_json(row[0]) if row else None

    def mutate(
        self,
        cart_id: str,
        operation_key: str | None,
        fingerprint: str,
        operation: Callable[[Cart], CartResponse],
        turn_lease: tuple[str, str] | None = None,
    ) -> CartResponse:
        # 读取、校验、写入和去重记录属于同一事务，避免并发丢失更新。
        with closing(self.connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT payload FROM carts WHERE id = ?", (cart_id,)).fetchone()
            if row is None:
                raise AgentToolError("cart_not_found", "Cart was not found.", status_code=404)
            if turn_lease:
                valid = connection.execute(
                    "SELECT 1 FROM conversation_turns WHERE cart_id = ? AND request_id = ? AND token = ? AND status = 'running' AND expires_at > ?",
                    (cart_id, *turn_lease, time.time()),
                ).fetchone()
                if not valid:
                    raise AgentToolError("turn_expired", "The conversation turn no longer has permission to change the cart.", status_code=409)
            if operation_key is not None:
                previous = connection.execute(
                    "SELECT fingerprint, response FROM cart_operations WHERE cart_id = ? AND operation_key = ?",
                    (cart_id, operation_key),
                ).fetchone()
                if previous:
                    if previous[0] != fingerprint:
                        raise AgentToolError("idempotency_conflict", "This request ID was already used for a different action.", status_code=409)
                    return CartResponse.model_validate_json(previous[1])
            cart = Cart.model_validate_json(row[0])
            response = operation(cart)
            connection.execute("UPDATE carts SET payload = ? WHERE id = ?", (cart.model_dump_json(), cart_id))
            if operation_key is not None:
                connection.execute(
                    "INSERT INTO cart_operations VALUES (?, ?, ?, ?)",
                    (cart_id, operation_key, fingerprint, response.model_dump_json()),
                )
            return response
