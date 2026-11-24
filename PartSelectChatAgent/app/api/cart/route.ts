import { NextResponse } from "next/server";
import { getOrCreateCart } from "@/lib/shopping";
import { cartErrorResponse, readCartId, setCartCookie } from "@/lib/cart-session";

export async function GET() {
  try {
    const cart = await getOrCreateCart(await readCartId());
    const response = NextResponse.json(cart);
    setCartCookie(response, cart.id);
    return response;
  } catch (error) {
    return cartErrorResponse(error);
  }
}
