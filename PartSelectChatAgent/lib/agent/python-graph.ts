import { randomUUID } from "node:crypto";
import type { AgentProgressEvent, AgentResponse, ConversationMemory } from "@/lib/types";
import { ShoppingError } from "@/lib/shopping";
import { AgentRunError } from "@/lib/agent/run-error";

type PythonGraphInput = {
  message: string;
  memory: ConversationMemory;
  requestId?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  onProgress?: (event: AgentProgressEvent) => void;
};

export async function executePythonGraph(
  input: PythonGraphInput
): Promise<{ response: AgentResponse; memory: ConversationMemory }> {
  if (input.onProgress) {
    return executePythonGraphStream(input);
  }
  const started = Date.now();
  try {
    const base = (process.env.SHOPPING_AGENT_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/agent/run`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: input.message,
        memory: input.memory,
        runId: input.requestId ?? randomUUID(),
        history: (input.history ?? []).slice(-8).map((item) => ({ ...item, content: item.content.slice(0, 1800) }))
      }),
      signal: AbortSignal.timeout(60_000)
    });
    const body = await response.json();
    if (!response.ok) {
      const details = body?.error?.details?.response as AgentResponse | undefined;
      throw new AgentRunError(
        new ShoppingError(body?.error?.code ?? "python_agent_failed", body?.error?.message ?? "Python Agent failed.", response.status),
        details?.trace ?? [],
        details?.tokens ?? { input: 0, output: 0, total: 0 },
        details?.responseTimeMs ?? Date.now() - started,
        "python_graph"
      );
    }
    if (typeof body?.response?.message !== "string" || body.response.executionMode !== "python_graph" || !body.memory) {
      throw new ShoppingError("python_agent_protocol", "Python Agent returned an invalid response.", 502);
    }
    return body;
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    const cause =
      error instanceof ShoppingError
        ? error
        : new ShoppingError("python_agent_unavailable", "Python Agent could not be reached or exceeded its time limit.", 503);
    throw new AgentRunError(cause, [], { input: 0, output: 0, total: 0 }, Date.now() - started, "python_graph");
  }
}

export async function executePythonGraphStream(
  input: PythonGraphInput
): Promise<{ response: AgentResponse; memory: ConversationMemory }> {
  const started = Date.now();
  try {
    const base = (process.env.SHOPPING_AGENT_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/agent/stream`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: input.message,
        memory: input.memory,
        runId: input.requestId ?? randomUUID(),
        history: (input.history ?? []).slice(-8).map((item) => ({ ...item, content: item.content.slice(0, 1800) }))
      }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok || !response.body) {
      throw new ShoppingError("python_agent_failed", "Python Agent stream unavailable.", response.status || 503);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: { response: AgentResponse; memory: ConversationMemory } | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        const parsed = JSON.parse(dataLines.join("\n"));
        if (eventName === "progress") {
          input.onProgress?.(parsed as AgentProgressEvent);
        } else if (eventName === "result") {
          finalPayload = parsed as { response: AgentResponse; memory: ConversationMemory };
        } else if (eventName === "error") {
          const details = parsed?.details?.response as AgentResponse | undefined;
          throw new AgentRunError(
            new ShoppingError(parsed?.code ?? "python_agent_failed", parsed?.message ?? "Python Agent failed.", parsed?.statusCode ?? 502),
            details?.trace ?? [],
            details?.tokens ?? { input: 0, output: 0, total: 0 },
            details?.responseTimeMs ?? Date.now() - started,
            "python_graph"
          );
        }
      }
    }

    if (!finalPayload || typeof finalPayload.response?.message !== "string" || finalPayload.response.executionMode !== "python_graph" || !finalPayload.memory) {
      throw new ShoppingError("python_agent_protocol", "Python Agent stream ended without a valid result.", 502);
    }
    return finalPayload;
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    const cause =
      error instanceof ShoppingError
        ? error
        : new ShoppingError("python_agent_unavailable", "Python Agent could not be reached or exceeded its time limit.", 503);
    throw new AgentRunError(cause, [], { input: 0, output: 0, total: 0 }, Date.now() - started, "python_graph");
  }
}
