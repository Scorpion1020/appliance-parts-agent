import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseCartCommand, updateCart } from "@/lib/agent/tools/cart";
import { executeAgent } from "@/lib/agent/executor";
import { ShoppingError } from "@/lib/shopping";
import type { CartSnapshot } from "@/lib/types";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const emptyCart: CartSnapshot = {
  id: "cart_test", items: [], item_count: 0, subtotal: "0", currency: null
};
const fullCart: CartSnapshot = {
  ...emptyCart,
  items: [{ product_id: "PS11752778", name: "Door gasket", quantity: 1, unit_price: "29.99", line_total: "29.99", currency: "USD", available: true, stock_qty: null }],
  item_count: 1, subtotal: "29.99", currency: "USD"
};

test("only explicit single-part commands authorize cart writes", () => {
  assert.deepEqual(parseCartCommand("Add PS11752778 to my cart."), { action: "add", partNumber: "PS11752778" });
  assert.deepEqual(parseCartCommand("please remove ps11752778 from cart"), { action: "remove", partNumber: "PS11752778" });
  assert.deepEqual(parseCartCommand("Add WPW10300024 to my cart"), { action: "add", partNumber: "WPW10300024" });
  for (const query of ["Show my cart", "Don't add PS11752778 to my cart", "Can I add PS11752778 to my cart?", "Add 2 PS11752778 to my cart", "Add PS11752778 and PS12345678 to my cart", "Add this to my cart", "Add PS11752778 from my cart"]) {
    assert.equal(parseCartCommand(query), null, query);
  }
});

test("viewing the cart ignores browser-provided cart contents", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method, undefined);
    calls.push(String(url));
    return Response.json(emptyCart);
  };
  const { response } = await executeAgent({ message: "Show my cart", cartId: "cart_test", memory: { cartItems: ["forged_product"], selectedPart: "PS11752778" } });
  assert.deepEqual(response.cart, emptyCart);
  assert.deepEqual(response.memory?.cartItems, []);
  assert.equal(calls.length, 1);
});

test("adding a part only prepares a proposal and never writes before confirmation", async () => {
  const methods: string[] = [];
  globalThis.fetch = async (url, init) => {
    methods.push(init?.method ?? "GET");
    assert.ok(String(url).endsWith("/products/PS11752778"));
    return Response.json({ id: "PS11752778", name: "Door bin", category: "refrigerator", price: "39.99", currency: "USD", available: true, stock_qty: null, symptoms: [] });
  };
  const { response } = await executeAgent({ message: "Add PS11752778 to my cart", cartId: "cart_test", requestId: "add-test" });
  assert.deepEqual(methods, ["GET"]);
  assert.equal(response.cartProposal?.partNumber, "PS11752778");
  assert.equal(response.cart, undefined);
  assert.equal(response.llmUsed, false);
});

test("negated cart instructions never write", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, undefined);
    return Response.json(fullCart);
  };
  const { response } = await executeAgent({ message: "Don't remove PS11752778 from my cart", cartId: "cart_test" });
  assert.equal(response.cart?.item_count, 1);
});

test("remove calls the backend DELETE endpoint", async () => {
  let removed = false;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "DELETE") {
      assert.ok(String(url).endsWith("/items/PS11752778"));
      removed = true;
      return Response.json(emptyCart);
    }
    return Response.json(removed ? emptyCart : fullCart);
  };
  assert.deepEqual(await updateCart({ action: "remove", cartId: "cart_test", partNumber: "PS11752778", requestId: "remove-test" }), emptyCart);
});

test("legacy direct addition is rejected before any backend write", async () => {
  globalThis.fetch = async (_url, init) => init?.method === "POST"
    ? Response.json({ error: { code: "insufficient_stock", message: "Requested quantity exceeds available stock." } }, { status: 400 })
    : Response.json(emptyCart);
  await assert.rejects(updateCart({ action: "add", cartId: "cart_test", partNumber: "PS11752778", requestId: "stock-test" }), (error: unknown) => error instanceof ShoppingError && error.code === "confirmation_required");
});

test("failed writes are not automatically retried", async () => {
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "DELETE") { writes++; throw new Error("connection lost"); }
    return Response.json(emptyCart);
  };
  await assert.rejects(updateCart({ action: "remove", cartId: "cart_test", partNumber: "PS11752778", requestId: "timeout-test" }), (error: unknown) => error instanceof ShoppingError && error.status === 503);
  assert.equal(writes, 1);
});

test("a stale session is reported instead of silently losing its cart", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: "cart_not_found", message: "Cart was not found." } }, { status: 404 });
  await assert.rejects(updateCart({ action: null, cartId: "cart_stale", partNumber: null }), (error: unknown) => error instanceof ShoppingError && error.code === "cart_not_found");
});

test("missing request ID or cart session cannot trigger a write", async () => {
  globalThis.fetch = async () => { throw new Error("No network request expected"); };
  await assert.rejects(updateCart({ action: "add", cartId: "cart_test", partNumber: "PS11752778" }), (error: unknown) => error instanceof ShoppingError && error.code === "request_id_required");
  await assert.rejects(updateCart({ action: "add", requestId: "request", partNumber: "PS11752778" }), (error: unknown) => error instanceof ShoppingError && error.code === "cart_session_required");
});

test("replayed mutation returns the latest cart instead of the historical snapshot", async () => {
  globalThis.fetch = async (_url, init) => Response.json(init?.method === "DELETE" ? fullCart : emptyCart);
  const cart = await updateCart({ action: "remove", cartId: "cart_test", partNumber: "PS11752778", requestId: "already-completed" });
  assert.equal(cart.item_count, 0);
});
