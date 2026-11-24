import { getOrCreateCart, shoppingRequest, ShoppingError } from "@/lib/shopping";
import type { CartSnapshot } from "@/lib/types";

export function parseCartCommand(query: string): { action: "add" | "remove"; partNumber: string } | null {
  const chinese = query.trim().match(/^(?:请)?(?:从购物车(?:中)?(?:移除|删除)\s*([A-Z][A-Z0-9]{5,})|(?:把|将)?\s*([A-Z][A-Z0-9]{5,})\s*(?:加入|添加到)购物车)[。！.!]?$/i);
  if (chinese) return { action: chinese[1] ? "remove" : "add", partNumber: (chinese[1] ?? chinese[2]).toUpperCase() };
  // 仅识别明确指令；加购只生成建议，删除走服务端校验，疑问和否定句不匹配。
  const match = query.trim().match(/^(?:please\s+)?(add|remove)\s+([A-Z][A-Z0-9]{5,})\s+(to|from)\s+(?:my\s+|the\s+)?cart[.!]?$/i);
  if (!match) return null;
  const action = match[1].toLowerCase() as "add" | "remove";
  if (match[3].toLowerCase() !== (action === "add" ? "to" : "from")) return null;
  return { action, partNumber: match[2].toUpperCase() };
}

export async function updateCart(input: {
  requestId?: string;
  turnToken?: string;
  action: "add" | "remove" | null;
  cartId?: string;
  partNumber: string | null;
}): Promise<CartSnapshot> {
  if (input.action && input.partNumber) {
    if (!input.cartId) throw new ShoppingError("cart_session_required", "Refresh the cart before changing it.", 409);
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId)) {
      throw new ShoppingError("request_id_required", "A valid request ID is required for cart changes.", 400);
    }
  }
  if (input.action === "add") throw new ShoppingError("confirmation_required", "请先生成加购建议，再点击确认按钮。", 409);
  const cart = await getOrCreateCart(input.cartId);
  if (!input.action || !input.partNumber) return cart;

  const path = `/carts/${encodeURIComponent(cart.id)}/items`;
  const headers: Record<string, string> = { "Idempotency-Key": input.requestId! };
  if (input.turnToken) {
    headers["X-Conversation-Request"] = input.requestId!;
    headers["X-Conversation-Token"] = input.turnToken;
  }
  await shoppingRequest(`${path}/${encodeURIComponent(input.partNumber)}`, { method: "DELETE", headers });
  // 重放响应可能是历史快照；侧栏必须展示当前购物车，而不是旧操作结果。
  return getOrCreateCart(cart.id);
}
