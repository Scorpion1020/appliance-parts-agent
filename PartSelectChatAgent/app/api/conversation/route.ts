import { NextResponse } from "next/server";
import { getConversation } from "@/lib/conversation";
import { getOrCreateCart } from "@/lib/shopping";
import { cartErrorResponse, readCartId, setCartCookie } from "@/lib/cart-session";

export async function GET() {
  try {
    const cart = await getOrCreateCart(await readCartId());
    const state = await getConversation(cart.id);
    const response = NextResponse.json({ ...state, cart });
    setCartCookie(response, cart.id);
    return response;
  } catch (error) {
    return cartErrorResponse(error);
  }
}

export async function POST() {
  try {
    // 显式开启新会话时忽略旧 cookie，创建独立的购物车与对话上下文。
    const cart = await getOrCreateCart(undefined);
    const state = await getConversation(cart.id);
    const response = NextResponse.json({ ...state, cart });
    setCartCookie(response, cart.id);
    return response;
  } catch (error) {
    return cartErrorResponse(error);
  }
}
