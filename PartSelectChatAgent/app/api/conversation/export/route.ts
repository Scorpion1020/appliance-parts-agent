import { NextResponse } from "next/server";
import { readCartId, cartErrorResponse } from "@/lib/cart-session";
import { getConversation } from "@/lib/conversation";
import { buildHandoffReport } from "@/lib/handoff-report";

export async function GET() {
  try {
    const cartId = await readCartId();
    if (!cartId) return NextResponse.json({ message: "请先加载会话，再导出记录。" }, { status: 409 });
    const state = await getConversation(cartId);
    return new Response(buildHandoffReport(state), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="support-handoff.txt"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) { return cartErrorResponse(error); }
}
