import { NextResponse } from "next/server";
import type { ChatRequest } from "@/lib/types";
import { runConversationTurn } from "@/lib/conversation";
import { EMPTY_INPUT_MESSAGE } from "@/lib/agent/prompts";
import { cartErrorResponse, readCartId } from "@/lib/cart-session";

export async function POST(request: Request) {
  let body: ChatRequest;

  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json(
      {
        message:
          "请求格式不正确，请重新输入问题。",
        intent: "out_of_scope"
      },
      { status: 400 }
    );
  }

  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json(
      {
        message: EMPTY_INPUT_MESSAGE,
        intent: "clarification_needed"
      },
      { status: 200 }
    );
  }

  if (!body.message.trim()) {
    return NextResponse.json(
      {
        message: EMPTY_INPUT_MESSAGE,
        intent: "clarification_needed"
      },
      { status: 200 }
    );
  }

  try {
    if (body.message.length > 4000 || typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) {
      return NextResponse.json({ message: "需要有效的请求编号，且消息不能超过 4000 个字符。", code: "invalid_request" }, { status: 400 });
    }
    const cartId = await readCartId();
    if (!cartId) return NextResponse.json({ message: "请先重新加载会话，再发送消息。", code: "session_required" }, { status: 409 });
    // 浏览器传入的 memory 和 currentModelNumber 只是旧客户端字段，不作为状态依据。
    return NextResponse.json(await runConversationTurn({ cartId, message: body.message.trim(), requestId: body.requestId }));
  } catch (error) {
    return cartErrorResponse(error);
  }
}
