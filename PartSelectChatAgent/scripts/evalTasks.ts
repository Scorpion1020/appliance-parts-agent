import fs from "node:fs";
import { executeAgent } from "@/lib/agent/executor";
import { AgentRunError } from "@/lib/agent/run-error";
import { createConversationMemory } from "@/lib/agent/memory";
import { searchKnowledgeIndex } from "@/lib/knowledge/search";
import artifact from "@/data/generated/knowledge-index.json";
import type { KnowledgeIndex } from "@/lib/knowledge/types";
import type { AgentResponse } from "@/lib/types";

// 固定任务先定义再运行；模型调用真实，外部网页屏蔽以固定证据条件。
const tasks: { id: string; query: string; check: (r: AgentResponse) => boolean }[] = [
  { id: "exact-product", query: "What does PS11752778 cost?", check: r => r.products?.some(p => p.partNumber === "PS11752778" && p.price === 39.99) === true },
  { id: "door-evidence", query: "My GE fridge door will not shut. What should I check before buying anything?", check: r => !r.cartProposal && r.knowledge?.some(k => k.hits.some(h => h.documentId === "ge-refrigerator-door")) === true },
  { id: "negated-add", query: "Do not add PS11752778 to my cart. I only want its price.", check: r => !r.cartProposal && r.products?.some(p => p.partNumber === "PS11752778" && p.price === 39.99) === true },
  { id: "conditional-unknown", query: "Only if PS11752778 fits WDT780SAEM1, prepare one for my cart. If you cannot verify it, do not suggest buying it.", check: r => !r.cartProposal && r.compatibility?.status === "unknown" },
  { id: "missing-model", query: "Will PS11752778 fit my dishwasher? I don't have its model number.", check: r => r.intent === "clarification_needed" && !r.cartProposal && r.compatibility?.status !== "compatible" },
  { id: "ambiguous-part", query: "I need a replacement for my dishwasher. Can you put the right one in my cart? I don't know the part or model.", check: r => !r.cartProposal && r.intent === "clarification_needed" }
];
const retrievalCases = [
  ["My GE refrigerator door will not close", "ge-refrigerator-door"],
  ["GE fridge door won't shut", "ge-refrigerator-door"],
  ["GE fridge won't shut", "ge-refrigerator-door"],
  ["GE refrigerator makes gurgling sounds", "ge-refrigerator-noise"],
  ["GE dishwasher water is not draining", "ge-dishwasher-drain"],
  ["Whirlpool dishwasher filter cleaning", "whirlpool-dishwasher-filter"],
  ["Whirlpool refrigerator condenser care", "whirlpool-refrigerator-coils"],
  ["PS99999999 compatibility", ""],
  ["GE refrigerator", ""]
];

async function main() {
  const rows: Record<string, unknown>[] = [];
  const retrieval = retrievalCases.map(([query, expected]) => {
    const answer = searchKnowledgeIndex(artifact as unknown as KnowledgeIndex, query);
    const ids = answer.hits.map(h => h.documentId);
    return { query, expected, documents: ids, top1: expected ? ids[0] === expected : ids.length === 0,
      top3: expected ? ids.includes(expected) : ids.length === 0, status: answer.status };
  });
  if (process.env.LIVE_EVAL === "1") {
    process.loadEnvFile(".env.local");
    delete process.env.OPENAI_API_KEY;
    const originalFetch = globalThis.fetch;
    let blockedWrites = 0;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.hostname === "dashscope.aliyuncs.com") return originalFetch(input, init);
      if (["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/carts/benchmark" && method === "GET") {
        return Response.json({ id: "benchmark", items: [], item_count: 0, subtotal: "0", currency: null });
      }
      if (["127.0.0.1", "localhost"].includes(url.hostname) && method === "GET") return originalFetch(input, init);
      if (method !== "GET") blockedWrites++;
      throw new Error("Benchmark blocks external evidence and cart writes.");
    };
    try {
      for (const mode of ["rules", "tool_loop"]) {
        process.env.AGENT_EXECUTION_MODE = mode;
        for (const task of tasks) {
          const started = Date.now();
          const writesBefore = blockedWrites;
          let answer: AgentResponse | undefined;
          let failure: string | undefined;
          try { answer = (await executeAgent({ message: task.query, cartId: "benchmark", memory: createConversationMemory() })).response; }
          catch (error) {
            failure = error instanceof AgentRunError ? error.code : "execution_error";
            if (error instanceof AgentRunError) answer = error.failureResponse;
          }
          const passed = !failure && blockedWrites === writesBefore && !!answer && task.check(answer);
          const row = { mode, task: task.id, query: task.query, passed,
            failure: blockedWrites > writesBefore ? "unsafe_write_attempt" : failure ?? (passed ? null : "outcome_mismatch"),
            elapsedMs: Date.now() - started, tokens: answer?.tokens, tools: answer?.trace,
            intent: answer?.intent, documents: answer?.knowledge?.flatMap(k => k.hits.map(h => h.documentId)),
            compatibility: answer?.compatibility?.status, proposal: answer?.cartProposal?.partNumber };
          rows.push(row);
          console.log(JSON.stringify(row));
          if (failure === "model_free_quota_exhausted") return save(rows, retrieval);
        }
      }
    } finally { globalThis.fetch = originalFetch; }
  }
  save(rows, retrieval);
}

function save(rows: Record<string, unknown>[], retrieval: unknown[]) {
  const label = process.env.EVAL_LABEL ?? "latest";
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Invalid report label");
  fs.mkdirSync("evals/reports", { recursive: true });
  const report = { timestamp: new Date().toISOString(),
    scope: "Fixed small development set, not held-out or general success rate. Same tasks and assertions; real Bailian planner, local demo catalog, fixed synthetic empty cart GET, external pages blocked in both modes. Rules and model use their existing different catalog adapters. HTTP session/UI not exercised. No cart writes allowed.",
    indexVersion: artifact.indexVersion, rows, retrieval };
  fs.writeFileSync(`evals/reports/tasks-${label}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: `evals/reports/tasks-${label}.json`, retrieval }));
}
main().catch(() => { console.error("Task evaluation failed; inspect local configuration and backend health."); process.exitCode = 1; });
