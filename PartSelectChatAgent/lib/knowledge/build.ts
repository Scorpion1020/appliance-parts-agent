import { createHash } from "node:crypto";
import { isKnowledgeSourceUrl } from "@/lib/knowledge/source";
import { tokenize } from "@/lib/knowledge/tokenize";
import type { KnowledgeDocument, KnowledgeIndex, KnowledgeChunk } from "@/lib/knowledge/types";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateManifest(value: unknown): KnowledgeDocument[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) throw new Error("Knowledge manifest must contain 1–1000 documents.");
  const ids = new Set<string>();
  const files = new Set<string>();
  const keys = ["id", "file", "title", "url", "reviewedAt", "sourceKind", "applianceType", "brand", "scope", "safety"];
  const documents = value.map((entry): KnowledgeDocument => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        Object.keys(entry).length !== keys.length || keys.some((key) => typeof entry[key] !== "string" || !entry[key].trim() || entry[key].length > 2000)) {
      throw new Error("Every knowledge document needs exactly the declared nonempty metadata fields.");
    }
    const doc = entry as KnowledgeDocument;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(doc.id) || !/^documents\/[a-z0-9-]+\.md$/.test(doc.file) ||
        !isKnowledgeSourceUrl(doc.url) || doc.sourceKind !== "editorial_summary" ||
        !["dishwasher", "refrigerator"].includes(doc.applianceType) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(doc.reviewedAt) || new Date(doc.reviewedAt).toISOString().slice(0, 10) !== doc.reviewedAt) {
      throw new Error("Invalid document identity, file path, source URL, type or review date.");
    }
    if (ids.has(doc.id) || files.has(doc.file)) throw new Error("Duplicate knowledge document ID or file.");
    ids.add(doc.id); files.add(doc.file);
    return Object.fromEntries(keys.map((key) => [key, entry[key]])) as KnowledgeDocument;
  });
  return documents.sort((left, right) => left.id.localeCompare(right.id));
}

export function buildKnowledgeIndex(manifest: unknown, contents: Record<string, string>): KnowledgeIndex {
  const documents = validateManifest(manifest);
  const chunks: KnowledgeChunk[] = [];
  for (const doc of documents) {
    const initialChunkCount = chunks.length;
    const text = contents[doc.file]?.replace(/\r\n/g, "\n").trim();
    if (!text || text.length > 100_000 || /<script\b|<iframe\b/i.test(text)) throw new Error("Missing, oversized or non-text knowledge document.");
    const version = digest(JSON.stringify(doc) + "\n" + text);
    let heading = doc.title;
    let paragraphs: string[] = [];
    const flush = () => {
      if (!paragraphs.length) return;
      const body = paragraphs.join("\n\n");
      // 不截断安全说明；过长段落要求维护者先拆分，避免丢失条件。
      if (body.length > 1800) throw new Error("Knowledge section exceeds 1800 characters; split it at an explicit heading.");
      const terms = tokenize(doc.title + " " + heading + " " + body);
      const frequencies: Record<string, number> = Object.create(null);
      for (const term of terms) frequencies[term] = (frequencies[term] ?? 0) + 1;
      chunks.push({ id: doc.id + ":" + digest(version + heading + body).slice(0, 16),
        documentId: doc.id, documentVersion: version, heading, text: body, terms: frequencies, length: terms.length });
      paragraphs = [];
    };
    for (const paragraph of text.split(/\n\s*\n/)) {
      const match = paragraph.match(/^#{1,3}\s+([^\n]+)(?:\n([\s\S]*))?$/);
      if (match) { flush(); heading = match[1].trim(); if (match[2]?.trim()) paragraphs.push(match[2].trim()); }
      else paragraphs.push(paragraph.trim());
    }
    flush();
    if (chunks.length === initialChunkCount) throw new Error("Every document must contain a nonempty section.");
  }
  if (!chunks.length || new Set(chunks.map((chunk) => chunk.id)).size !== chunks.length) throw new Error("Empty or duplicate knowledge chunks.");
  return { schemaVersion: 1, indexVersion: digest(JSON.stringify({ documents, chunks })), documents, chunks };
}
