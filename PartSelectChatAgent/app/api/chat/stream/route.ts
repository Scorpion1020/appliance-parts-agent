import type { ChatRequest } from "@/lib/types";
import { runConversationTurn } from "@/lib/conversation";
import { EMPTY_INPUT_MESSAGE } from "@/lib/agent/prompts";
import { readCartId } from "@/lib/cart-session";
import { ShoppingError } from "@/lib/shopping";
import { AgentRunError } from "@/lib/agent/run-error";
import { chineseError } from "@/lib/zh";

export const dynamic = "force-dynamic";

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return new Response(JSON.stringify({ message: "请求格式不正确，请重新输入问题。", intent: "out_of_scope" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return new Response(JSON.stringify({ message: EMPTY_INPUT_MESSAGE, intent: "clarification_needed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  if (body.message.length > 4000 || typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) {
    return new Response(JSON.stringify({ message: "需要有效的请求编号，且消息不能超过 4000 个字符。", code: "invalid_request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const cartId = await readCartId();
  if (!cartId) {
    return new Response(JSON.stringify({ message: "请先重新加载会话，再发送消息。", code: "session_required" }), {
      status: 409,
      headers: { "Content-Type": "application/json" }
    });
  }

  const trimmed = body.message.trim();
  const requestId = body.requestId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const result = await runConversationTurn({
          cartId,
          message: trimmed,
          requestId,
          onProgress: (event) => {
            try {
              controller.enqueue(encodeSse("progress", event));
            } catch {
              // 客户端断开时忽略推送错误
            }
          }
        });
        controller.enqueue(encodeSse("result", result));
      } catch (error) {
        if (error instanceof AgentRunError) {
          controller.enqueue(
            encodeSse("error", {
              code: error.code ?? "agent_failed",
              message: chineseError(error.code, error.message),
              response: error.failureResponse
            })
          );
        } else if (error instanceof ShoppingError) {
          controller.enqueue(
            encodeSse("error", {
              code: error.code,
              message: chineseError(error.code, error.message)
            })
          );
        } else {
          controller.enqueue(
            encodeSse("error", {
              code: "internal_error",
              message: "服务暂时不可用，请稍后重试。"
            })
          );
        }
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
