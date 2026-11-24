import type { ChatMessage, ConversationState, Product } from "@/lib/types";

export function restoreMessages(state: ConversationState): ChatMessage[] {
  return state.turns.flatMap((turn): ChatMessage[] => [
    { id: `${turn.request_id}-user`, role: "user", content: turn.message },
    turn.status === "completed" && turn.response
      ? { id: `${turn.request_id}-assistant`, role: "assistant", content: turn.response.message, response: turn.response, feedback: turn.feedback ?? null }
      : { id: `${turn.request_id}-error`, role: "assistant",
          content: turn.status === "running" ? "This request is still running. Wait before retrying." : turn.error ?? "This request failed. Retry with the same operation ID.",
          response: turn.status === "failed" ? turn.response ?? undefined : undefined }
  ]);
}

export function recentlyViewedFromHistory(state: ConversationState): Product[] {
  const products = state.turns.slice().reverse().flatMap((turn) => turn.response?.products ?? []);
  return products.filter((product, index) => products.findIndex((item) => item.partNumber === product.partNumber) === index).slice(0, 6);
}
