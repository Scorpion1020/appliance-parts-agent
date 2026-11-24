import { tokenize } from "@/lib/knowledge/tokenize";
import type { ApplianceType } from "@/lib/types";
import type { KnowledgeIndex, KnowledgeSearch, KnowledgeHit } from "@/lib/knowledge/types";

function frequency(terms: Record<string, number>, term: string): number {
  return Object.prototype.hasOwnProperty.call(terms, term) ? terms[term] : 0;
}

// BM25 分数只用于排序，不是答案置信度。
export function searchKnowledgeIndex(index: KnowledgeIndex, query: string, options: { applianceType?: ApplianceType | null; limit?: number } = {}): KnowledgeSearch {
  if (typeof query !== "string" || query.length > 1000) throw new Error("Knowledge query must be a string of at most 1000 characters.");
  const limit = options.limit ?? 3;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error("Knowledge result limit must be 1–5.");
  // 只补自然说法的检索词，不改编号，也不把症状扩写成故障结论。
  const normalizedQuery = query.replace(/\bfridge\b/gi, "refrigerator")
    .replace(/\bshut\b/gi, "close closing");
  const queryTerms = [...new Set(tokenize(normalizedQuery))];
  const broadTerms = new Set(["dishwasher", "refrigerator", "fridge", "whirlpool", "ge", "appliance", "help", "problem", "guide", "manual"]);
  const topical = queryTerms.filter((term) => !broadTerms.has(term));
  const base = { indexVersion: index.indexVersion, method: "bm25" as const };
  if (!topical.length) return { ...base, status: "insufficient_query", hits: [] };
  const identifiers = queryTerms.filter((term) => /[a-z]/.test(term) && /\d/.test(term));
  const documents = new Map(index.documents.map((doc) => [doc.id, doc]));
  const requestedBrands = ["Whirlpool", "GE"].filter((brand) => new RegExp("\\b" + brand + "\\b", "i").test(query));
  const corpus = index.chunks.filter((chunk) => {
    const doc = documents.get(chunk.documentId);
    return doc && (!options.applianceType || doc.applianceType === options.applianceType) &&
      (!requestedBrands.length || requestedBrands.includes(doc.brand));
  });
  if (!corpus.length) return { ...base, status: "no_evidence", hits: [] };
  const averageLength = corpus.reduce((sum, chunk) => sum + chunk.length, 0) / corpus.length;
  const documentFrequency = new Map(queryTerms.map((term) => [term, corpus.filter((chunk) => frequency(chunk.terms, term) > 0).length]));
  const hits: KnowledgeHit[] = [];
  for (const chunk of corpus) {
    if (!topical.some((term) => frequency(chunk.terms, term) > 0) || identifiers.some((term) => !frequency(chunk.terms, term))) continue;
    let score = 0;
    for (const term of queryTerms) {
      const countInChunk = frequency(chunk.terms, term);
      if (!countInChunk) continue;
      const count = documentFrequency.get(term) ?? 0;
      const inverse = Math.log(1 + (corpus.length - count + 0.5) / (count + 0.5));
      score += inverse * countInChunk * 2.2 / (countInChunk + 1.2 * (0.25 + 0.75 * chunk.length / averageLength));
    }
    const doc = documents.get(chunk.documentId)!;
    hits.push({ chunkId: chunk.id, documentId: doc.id, documentVersion: chunk.documentVersion,
      title: doc.title, heading: chunk.heading, summary: chunk.text, sourceUrl: doc.url, reviewedAt: doc.reviewedAt,
      sourceKind: doc.sourceKind, scope: doc.scope, safety: doc.safety, score: Number(score.toFixed(4)) });
  }
  hits.sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
  return { ...base, status: hits.length ? "found" : "no_evidence", hits: hits.slice(0, limit) };
}
