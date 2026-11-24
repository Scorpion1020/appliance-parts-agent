import { ShoppingError } from "@/lib/shopping";
import type { AgentResponse, AgentTraceStep } from "@/lib/types";

export class AgentRunError extends ShoppingError {
  readonly failureResponse: AgentResponse;

  constructor(error: unknown, trace: AgentTraceStep[], tokens: { input: number; output: number; total: number }, elapsedMs: number, executionMode: NonNullable<AgentResponse["executionMode"]> = "tool_loop") {
    const cause = error instanceof ShoppingError ? error : new ShoppingError("agent_failed", "The agent could not finish this request.", 502);
    super(cause.code, cause.message, cause.status);
    this.failureResponse = {
      message: cause.message, intent: "clarification_needed", tool: "none",
      executionMode, trace: structuredClone(trace), tokens: { ...tokens }, llmUsed: tokens.total > 0,
      responseTimeMs: elapsedMs
    };
  }
}
