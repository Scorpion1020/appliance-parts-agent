import { NextResponse } from "next/server";
import { readCartId } from "@/lib/cart-session";
import { shoppingRequest, ShoppingError } from "@/lib/shopping";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      requestId?: string;
      rating?: "up" | "down";
      reason?: string;
      comment?: string;
    };
    if (
      typeof body?.requestId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId) ||
      !["up", "down"].includes(body.rating ?? "")
    ) {
      return NextResponse.json({ message: "反馈参数无效。" }, { status: 400 });
    }
    const cartId = await readCartId();
    if (!cartId) {
      return NextResponse.json({ message: "会话不存在，无法提交反馈。" }, { status: 409 });
    }
    const result = await shoppingRequest(
      `/carts/${encodeURIComponent(cartId)}/conversation/turns/${encodeURIComponent(body.requestId)}/feedback`,
      {
        method: "POST",
        body: JSON.stringify({
          rating: body.rating,
          ...(body.reason ? { reason: body.reason } : {}),
          ...(body.comment ? { comment: body.comment.slice(0, 500) } : {})
        })
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof ShoppingError ? error.status : 500;
    return NextResponse.json({ message: "反馈记录失败，请稍后重试。" }, { status });
  }
}
