import { executeAgent } from "@/lib/agent/executor";
import { AgentRunError } from "@/lib/agent/run-error";
import { mergeConversationMemory } from "@/lib/agent/memory";
import { getOrCreateCart, shoppingRequest, ShoppingError } from "@/lib/shopping";
import type { AgentResponse, ConversationState } from "@/lib/types";
import { createHash } from "node:crypto";
import { getBackendProduct } from "@/lib/catalog/backend";
import { runReadTool } from "@/lib/agent/model-tools";
import { chineseText, chineseError } from "@/lib/zh";

function confirmationId(proposalId: string) {
  return "confirm-" + createHash("sha256").update(proposalId).digest("hex");
}

type StartedTurn = ConversationState & ({ replayed: true; response: AgentResponse } | { replayed: false; token: string });

export function getConversation(cartId: string) {
  return shoppingRequest<ConversationState>(`/carts/${encodeURIComponent(cartId)}/conversation`);
}

export async function runConversationTurn(
  input: {
    cartId: string;
    message: string;
    requestId: string;
    onProgress?: (event: import("@/lib/types").AgentProgressEvent) => void;
  },
  executor = executeAgent
): Promise<AgentResponse> {
  const base = `/carts/${encodeURIComponent(input.cartId)}/conversation/turns`;
  const turn = await shoppingRequest<StartedTurn>(base, {
    method: "POST", body: JSON.stringify({ request_id: input.requestId, message: input.message })
  });
  if (turn.replayed) {
    return { ...turn.response, memory: turn.memory, ...(turn.response.cart ? { cart: await getOrCreateCart(input.cartId) } : {}) };
  }
  let completedResponse: AgentResponse | undefined;
  try {
    const confirm = input.message.match(/^(?:Confirm cart proposal |确认加购建议 )([A-Za-z0-9_-]{1,128})$/);
    let result;
    if (confirm) {
      const source = turn.turns.find(item => item.request_id === confirm[1] && item.status === "completed");
      const proposal = source?.response?.cartProposal;
      if (!proposal || input.requestId !== confirmationId(confirm[1])) {
        throw new ShoppingError("invalid_confirmation", "The saved proposal is unavailable. Ask for a new proposal.", 409);
      }
      // 后续查到风险时，旧消息里的按钮也不能继续提交。
      const sourceIndex = turn.turns.indexOf(source!);
      const conflictingEvidence = turn.turns.slice(sourceIndex).some(item =>
        item.status === "completed" && (item.response?.compatibilities ?? (item.response?.compatibility ? [item.response.compatibility] : []))
          .some(check => check.partNumber === proposal.partNumber && check.status !== "compatible"));
      if (conflictingEvidence) {
        throw new ShoppingError("proposal_conflict", "Later compatibility evidence blocks this proposal. Review the evidence and request a new proposal.", 409);
      }
      // 旧建议不能跨设备复用；未绑定上下文的历史建议要求重新生成。
      if (proposal.modelNumber === undefined || proposal.applianceType === undefined ||
          proposal.modelNumber !== turn.memory.currentModelNumber || proposal.applianceType !== turn.memory.applianceType) {
        throw new ShoppingError("proposal_context_changed", "The appliance or model context changed. Request a new proposal before confirming.", 409);
      }
      const product = await getBackendProduct(proposal.partNumber);
      if (proposal.modelNumber) {
        const current = await runReadTool("checkCompatibility", { partNumber: proposal.partNumber, modelNumber: proposal.modelNumber }, turn.memory);
        if (current.compatibility?.status !== "compatible") {
          throw new ShoppingError("proposal_evidence_changed", "Current evidence no longer supports this proposal. Request a new compatibility check.", 409);
        }
      }
      if (!product.purchasable || product.price !== proposal.unitPrice) {
        throw new ShoppingError("proposal_changed", "Product availability or price changed. Request a new proposal before confirming.", 409);
      }
      await shoppingRequest(`/carts/${encodeURIComponent(input.cartId)}/items`, {
        method: "POST", headers: { "Idempotency-Key": input.requestId, "X-Conversation-Request": input.requestId, "X-Conversation-Token": turn.token },
        body: JSON.stringify({ product_id: proposal.partNumber, quantity: proposal.quantity })
      });
      const cart = await getOrCreateCart(input.cartId);
      result = { memory: { ...turn.memory, cartItems: cart.items.map(item => item.product_id) }, response: {
        intent: "cart_action" as const, tool: "addToCart" as const, cart, llmUsed: false,
        message: `Confirmed: added ${proposal.quantity} × ${proposal.partNumber} to the cart. No order or payment was made.`
      } as AgentResponse };
    } else {
      result = await executor({
      message: input.message, requestId: input.requestId, cartId: input.cartId,
      memory: turn.memory, turnToken: turn.token, onProgress: input.onProgress,
      history: turn.turns.filter(item => item.status === "completed" && item.response).slice(-4).flatMap(item => [
        { role: "user" as const, content: item.message },
        { role: "assistant" as const, content: item.response!.message }
      ])
      });
    }
    const memory = mergeConversationMemory(result.memory, result.response.memory);
    if (result.response.tool === "searchProducts" || result.response.trace?.some(step => step.tool === "searchProducts" && step.status === "ok")) {
      memory.candidates = (result.response.products ?? []).slice(0, 5).map(({ partNumber, manufacturerPartNumber, name }) => ({ partNumber, manufacturerPartNumber, name }));
    }
    const response = { ...result.response, memory, message: chineseText(result.response.message),
      steps: result.response.steps?.map(chineseText),
      sections: result.response.sections?.map(section => ({ title: chineseText(section.title), items: section.items.map(chineseText) })) };
    if (response.cartProposal) response.cartProposal = { ...response.cartProposal, requestId: input.requestId,
      confirmationId: confirmationId(input.requestId), modelNumber: memory.currentModelNumber, applianceType: memory.applianceType };
    completedResponse = response;
    await shoppingRequest<ConversationState>(`${base}/${encodeURIComponent(input.requestId)}`, {
      method: "PUT", body: JSON.stringify({ token: turn.token, memory, response })
    });
    return response;
  } catch (error) {
    const failure = !(error instanceof AgentRunError) && completedResponse?.executionMode
      ? new AgentRunError(error, completedResponse.trace ?? [], completedResponse.tokens ?? { input: 0, output: 0, total: 0 }, completedResponse.responseTimeMs ?? 0, completedResponse.executionMode)
      : error;
    try {
      await shoppingRequest(`${base}/${encodeURIComponent(input.requestId)}/fail`, {
        method: "POST", body: JSON.stringify({
          token: turn.token,
          error: failure instanceof ShoppingError ? chineseError(failure.code, failure.message).slice(0, 500) : "智能体执行失败，请重试同一请求。",
          ...(failure instanceof AgentRunError ? { diagnostics: {
            trace: failure.failureResponse.trace, tokens: failure.failureResponse.tokens,
            responseTimeMs: failure.failureResponse.responseTimeMs, executionMode: failure.failureResponse.executionMode
          } } : {})
        })
      });
    } catch {
      // 保存失败时不假装成功；租约到期后允许携带同编号恢复。
      console.error("Could not record failed turn; recovery requires the original request ID.");
    }
    throw failure;
  }
}
