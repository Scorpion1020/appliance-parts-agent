import type { ApplianceType } from "@/lib/types";

export type KnowledgeDocument = {
  id: string;
  file: string;
  title: string;
  url: string;
  reviewedAt: string;
  sourceKind: "editorial_summary";
  applianceType: ApplianceType;
  brand: string;
  scope: string;
  safety: string;
};
export type KnowledgeChunk = {
  id: string;
  documentId: string;
  documentVersion: string;
  heading: string;
  text: string;
  terms: Record<string, number>;
  length: number;
};
export type KnowledgeIndex = {
  schemaVersion: 1;
  indexVersion: string;
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
};
export type KnowledgeHit = {
  chunkId: string;
  documentId: string;
  documentVersion: string;
  title: string;
  heading: string;
  summary: string;
  sourceUrl: string;
  reviewedAt: string;
  sourceKind: "editorial_summary";
  scope: string;
  safety: string;
  score: number;
};
export type KnowledgeSearch = {
  indexVersion: string;
  method: "bm25" | "hybrid";
  embeddingModel?: string;
  status: "found" | "no_evidence" | "insufficient_query";
  hits: KnowledgeHit[];
};
