import artifact from "@/data/generated/knowledge-index.json";
import { searchKnowledgeIndex } from "@/lib/knowledge/search";
import type { KnowledgeIndex } from "@/lib/knowledge/types";
import type { AgentResponse, ApplianceType } from "@/lib/types";
import { ShoppingError } from "@/lib/shopping";
import { detectApplianceType } from "@/lib/agent/router";

export function searchKnowledge(query: string, applianceType?: ApplianceType | null): AgentResponse {
  if (query.length > 1000) throw new ShoppingError("invalid_knowledge_query", "Knowledge queries must be at most 1000 characters.", 400);
  // 本地生成产物由 knowledge:check 与构建测试验证，不接受浏览器传入索引。
  const result = searchKnowledgeIndex(artifact as unknown as KnowledgeIndex, query, { applianceType: detectApplianceType(query) ?? applianceType });
  return {
    intent: "knowledge_lookup", tool: "searchKnowledge", groundingStatus: "unverified",
    message: result.status === "found"
      ? "I found reviewed summaries of manufacturer guidance. These are general maintenance notes, not a diagnosis, a live-page check, or proof of parts compatibility. Read the source and your model's manual before acting."
      : result.status === "insufficient_query"
        ? "Please describe the maintenance topic or symptom you want to look up."
        : "The current knowledge collection has no matching evidence for this question. This does not prove that a fault or compatibility relationship is absent. Check the exact model's manual or contact the manufacturer.",
    knowledge: [result], sources: [], llmUsed: false, tokens: { input: 0, output: 0, total: 0 }
  };
}
