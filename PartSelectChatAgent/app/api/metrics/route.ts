import { NextResponse } from "next/server";
import { readCartId } from "@/lib/cart-session";
import { shoppingRequest, ShoppingError } from "@/lib/shopping";

export async function GET() {
  try {
    const cartId = await readCartId();
    if (!cartId) {
      return NextResponse.json({ message: "会话不存在。" }, { status: 409 });
    }
    const metrics = await shoppingRequest(`/carts/${encodeURIComponent(cartId)}/conversation/metrics`);
    return NextResponse.json(metrics);
  } catch (error) {
    const status = error instanceof ShoppingError ? error.status : 500;
    return NextResponse.json({ message: "指标获取失败。" }, { status });
  }
}
