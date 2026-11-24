import { ShoppingError } from "@/lib/shopping";

export type FunctionCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: FunctionCall[];
  tool_call_id?: string;
};
export type FunctionDefinition = {
  type: "function";
  function: { name: string; description: string; strict: true; parameters: Record<string, unknown> };
};
export type ModelReply = { call: FunctionCall; model?: string; quotaSkippedModels?: string[]; tokens: { input: number; output: number; total: number } };
export type ToolModel = (messages: ModelMessage[], tools: FunctionDefinition[], signal: AbortSignal) => Promise<ModelReply>;

export class ModelProtocolError extends ShoppingError {
  constructor(public readonly tokens: ModelReply["tokens"]) {
    super("model_protocol_error", "The model did not return one valid tool call.", 502);
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseModelReply(payload: unknown): ModelReply {
  const body = object(payload);
  const usage = object(body?.usage);
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const tokens = { input: count(usage?.prompt_tokens), output: count(usage?.completion_tokens), total: count(usage?.total_tokens) };
  const choices = body?.choices;
  const choice = Array.isArray(choices) ? object(choices[0]) : null;
  const message = object(choice?.message);
  const calls = message?.tool_calls;
  const call = Array.isArray(calls) && calls.length === 1 ? object(calls[0]) : null;
  const fn = object(call?.function);
  if (choice?.finish_reason !== "tool_calls" || call?.type !== "function" ||
      typeof call.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
      typeof fn?.name !== "string" || typeof fn.arguments !== "string" || fn.arguments.length > 8000) {
    throw new ModelProtocolError(tokens);
  }
  return {
    call: { id: call.id, type: "function", function: { name: fn.name, arguments: fn.arguments } },
    tokens
  };
}

export const callToolModel: ToolModel = async (messages, tools, signal) => {
  const provider = process.env.MODEL_PROVIDER?.trim() || "openai";
  if (provider !== "openai" && provider !== "bailian") {
    throw new ShoppingError("model_not_configured", "Unsupported MODEL_PROVIDER.", 503);
  }
  const bailian = provider === "bailian";
  const key = (bailian ? process.env.DASHSCOPE_API_KEY : process.env.OPENAI_API_KEY)?.trim();
  if (!key || key === "your_api_key_here") {
    throw new ShoppingError("model_not_configured", "Tool-loop mode requires a configured server-side model key.", 503);
  }
  try {
    const primary = bailian ? (process.env.DASHSCOPE_MODEL?.trim() || "qwen-plus") : (process.env.OPENAI_MODEL?.trim() || "gpt-4.1-nano");
    const models = [...new Set([primary, ...(bailian ? (process.env.DASHSCOPE_FALLBACK_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean) : [])])];
    if (models.length > 4 || models.some(model => !/^[A-Za-z0-9._-]+$/.test(model))) {
      throw new ShoppingError("model_not_configured", "Configure at most four valid model names.", 503);
    }
    const quotaSkippedModels: string[] = [];
    for (const model of models) {
    signal.throwIfAborted();
    const response = await fetch(bailian
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(bailian ? { max_tokens: 700, enable_thinking: false } : { max_completion_tokens: 700, store: false }),
        messages,
        tools: bailian ? tools.map(({ function: fn, ...tool }) => {
          const { strict: _strict, ...definition } = fn;
          return { ...tool, function: definition };
        }) : tools,
        tool_choice: bailian ? "auto" : "required", parallel_tool_calls: false
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const code = object(object(payload)?.error)?.code;
      if (bailian && code === "AllocationQuota.FreeTierOnly") {
        quotaSkippedModels.push(model);
        console.info(JSON.stringify({ event: "model_quota_exhausted", model }));
        continue;
      }
      throw new ShoppingError("model_unavailable", `The model service returned HTTP ${response.status}. No automatic retry was attempted.`, 502);
    }
    const reply = parseModelReply(await response.json());
    console.info(JSON.stringify({ event: "model_call_completed", model, quotaSkippedModels, tokens: reply.tokens }));
    return { ...reply, model, quotaSkippedModels };
    }
    throw new ShoppingError("model_free_quota_exhausted", "All configured models have exhausted their free quota. No paid-model switch was attempted.", 403);
  } catch (error) {
    if (error instanceof ShoppingError) throw error;
    throw new ShoppingError("model_unavailable", "The model request failed or timed out. Retry this request.", 503);
  }
};
