import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ShoppingError } from "@/lib/shopping";
import { AgentRunError } from "@/lib/agent/run-error";
import { chineseError } from "@/lib/zh";

const CART_COOKIE = "shopping_cart";

export async function readCartId() {
  return (await cookies()).get(CART_COOKIE)?.value;
}

export function setCartCookie(response: NextResponse, cartId: string) {
  response.cookies.set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.COOKIE_SECURE === "false" ? false : process.env.NODE_ENV === "production",
    path: "/"
  });
}

export function cartErrorResponse(error: unknown) {
  if (!(error instanceof ShoppingError)) throw error;
  const response = NextResponse.json({
    message: chineseError(error.code, error.message), code: error.code,
    ...(error instanceof AgentRunError ? { response: error.failureResponse } : {})
  }, { status: error.status });
  if (error.code === "cart_not_found") response.cookies.delete(CART_COOKIE);
  return response;
}
