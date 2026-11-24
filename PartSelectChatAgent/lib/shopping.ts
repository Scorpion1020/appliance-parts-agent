import type { CartSnapshot } from "@/lib/types";

export class ShoppingError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export async function shoppingRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = process.env.SHOPPING_AGENT_URL ?? "http://127.0.0.1:8000";
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // 写入超时不自动重试，避免同一个商品被重复添加。
    throw new ShoppingError("backend_unavailable", "The cart service could not be reached. Refresh the cart before retrying an action.", 503);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ShoppingError(body?.error?.code ?? "backend_error", body?.error?.message ?? "The cart service returned an error.", response.status);
  }
  return response.json() as Promise<T>;
}

export function getOrCreateCart(cartId?: string): Promise<CartSnapshot> {
  return cartId
    ? shoppingRequest(`/carts/${encodeURIComponent(cartId)}`)
    : shoppingRequest("/carts", { method: "POST" });
}
