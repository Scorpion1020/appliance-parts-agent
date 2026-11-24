import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import manifest from "@/knowledge/manifest.json";
import artifact from "@/data/generated/knowledge-index.json";
import { buildKnowledgeIndex, validateManifest } from "@/lib/knowledge/build";
import { searchKnowledgeIndex } from "@/lib/knowledge/search";
import { isKnowledgeSourceUrl } from "@/lib/knowledge/source";
import { searchKnowledge } from "@/lib/agent/tools/knowledge";
import { executeAgent } from "@/lib/agent/executor";
import { executeModelLoop } from "@/lib/agent/model-loop";
import { createConversationMemory } from "@/lib/agent/memory";
import { KnowledgeEvidence } from "@/components/KnowledgeEvidence";
import { ShoppingError } from "@/lib/shopping";

const contents = Object.fromEntries(manifest.map((doc) => [doc.file, readFileSync(path.join(process.cwd(), "knowledge", doc.file), "utf8")]));
const index = buildKnowledgeIndex(manifest, contents);

test("checked-in index exactly reproduces current source content and metadata", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(index)), artifact);
  assert.equal(index.documents.length, manifest.length);
  assert.ok(index.chunks.length >= manifest.length);
  assert.deepEqual(buildKnowledgeIndex([...manifest].reverse(), contents), index);
  assert.deepEqual(buildKnowledgeIndex(manifest, Object.fromEntries(Object.entries(contents).map(([file, text]) => [file, text.replace(/\n/g, "\r\n")]))), index);
});

test("changing source text changes document and index versions", () => {
  const changed = buildKnowledgeIndex(manifest, { ...contents, [manifest[0].file]: contents[manifest[0].file] + "\n\nAdditional reviewed note." });
  assert.notEqual(changed.indexVersion, index.indexVersion);
  const originalChunk = index.chunks.find((chunk) => chunk.documentId === manifest[0].id);
  const changedChunk = changed.chunks.find((chunk) => chunk.documentId === manifest[0].id);
  assert.ok(originalChunk && changedChunk);
  assert.notEqual(changedChunk.documentVersion, originalChunk.documentVersion);
});

test("manifest rejects duplicate IDs, unsafe paths, invalid dates and unapproved sources", () => {
  assert.throws(() => validateManifest([manifest[0], manifest[0]]));
  for (const patch of [
    { file: "../secrets.md" }, { url: "https://producthelp.whirlpool.com.evil.example/a" },
    { url: "http://producthelp.whirlpool.com/a" }, { reviewedAt: "2026-02-30" },
    { sourceKind: "live" }, { title: "" }
  ]) assert.throws(() => validateManifest([{ ...manifest[0], ...patch }]));
});

test("empty and oversized sections fail instead of losing important conditions", () => {
  assert.throws(() => buildKnowledgeIndex(manifest, { ...contents, [manifest[0].file]: "## Empty heading" }));
  assert.throws(() => buildKnowledgeIndex(manifest, { ...contents, [manifest[0].file]: "x".repeat(1801) }));
});

test("topic queries retrieve the appropriate manufacturer document", () => {
  for (const [query, expected] of [
    ["disposer replacement drain plug", "ge-dishwasher-drain"],
    ["Whirlpool dishwasher removable filter cleaning", "whirlpool-dishwasher-filter"],
    ["Whirlpool refrigerator condenser coils", "whirlpool-refrigerator-coils"]
  ]) {
    const result = searchKnowledgeIndex(index, query);
    assert.equal(result.status, "found", query);
    assert.equal(result.hits[0].documentId, expected, query);
    assert.ok(result.hits.every((hit) => hit.sourceKind === "editorial_summary" && hit.safety && hit.scope));
  }
});

test("missing model identifiers and unrelated topics do not manufacture evidence", () => {
  for (const query of ["PS99999999 filter", "WDT780SAEM1 compatibility", "dishwasher quantum entanglement"]) {
    assert.equal(searchKnowledgeIndex(index, query).status, "no_evidence", query);
  }
  assert.equal(searchKnowledgeIndex(index, "dishwasher").status, "insufficient_query");
  assert.equal(searchKnowledgeIndex(index, "").status, "insufficient_query");
});

test("appliance and explicit brand filters prevent cross-brand answers", () => {
  assert.deepEqual(searchKnowledgeIndex(index, "condenser", { applianceType: "dishwasher" }).hits, []);
  assert.deepEqual(searchKnowledgeIndex(index, "Whirlpool disposer plug").hits, []);
  assert.ok(searchKnowledgeIndex(index, "GE drain").hits.every((hit) => hit.documentId === "ge-dishwasher-drain"));
});

test("prototype-shaped terms cannot alter counts or produce invalid scores", () => {
  assert.equal(searchKnowledgeIndex(index, "constructor").status, "no_evidence");
  assert.ok(searchKnowledgeIndex(index, "constructor filter").hits.every((hit) => Number.isFinite(hit.score)));
  const special = buildKnowledgeIndex([manifest[0]], { [manifest[0].file]: "## Prototype\nconstructor constructor" });
  assert.equal(special.chunks[0].terms.constructor, 2);
  assert.ok(searchKnowledgeIndex(JSON.parse(JSON.stringify(special)), "constructor").hits[0].score > 0);
});

test("limits and unsafe citation URLs are rejected", () => {
  assert.throws(() => searchKnowledgeIndex(index, "filter", { limit: 0 }));
  assert.throws(() => searchKnowledgeIndex(index, "filter", { limit: 6 }));
  assert.throws(() => searchKnowledge("x".repeat(1001)), (error: unknown) => error instanceof ShoppingError && error.status === 400);
  for (const url of ["javascript:alert(1)", "https://user@producthelp.whirlpool.com/x", "https://products.geappliances.com:444/x"]) assert.equal(isKnowledgeSourceUrl(url), false);
});

test("knowledge evidence UI identifies summaries, version and safety without live verification claims", () => {
  const result = searchKnowledgeIndex(index, "condenser");
  const html = renderToStaticMarkup(createElement(KnowledgeEvidence, { searches: [result] }));
  assert.match(html, /人工整理摘要/);
  assert.match(html, /文档版本/);
  assert.match(html, /Disconnect electrical power/);
  assert.match(html, /不代表可信度/);
  assert.doesNotMatch(html, /Verified live/);
});

test("explicit knowledge command works without model or network and never asserts compatibility", async () => {
  const result = await executeAgent({ message: "Search knowledge: Whirlpool dishwasher filter", memory: createConversationMemory() });
  assert.equal(result.response.tool, "searchKnowledge");
  assert.equal(result.response.llmUsed, false);
  assert.equal(result.response.compatibility, undefined);
  assert.equal(result.response.knowledge?.[0].status, "found");
  assert.equal(result.response.groundingStatus, "unverified");
});

test("model loop receives real local retrieval output and preserves citations on finish", async () => {
  let calls = 0;
  const result = await executeModelLoop({ message: "How to clean condenser coils?", memory: createConversationMemory() }, {
    model: async (messages) => {
      calls++;
      if (calls === 2) {
        const feedback = JSON.parse(messages.at(-1)!.content!);
        assert.equal(feedback.result.knowledge[0].indexVersion, index.indexVersion);
        assert.ok(feedback.result.knowledge[0].hits[0].documentVersion);
      }
      return { call: { id: "call" + calls, type: "function", function: calls === 1
        ? { name: "searchKnowledge", arguments: JSON.stringify({ query: "condenser coils" }) }
        : { name: "finish", arguments: JSON.stringify({ resultIds: ["call1"], missing: "none" }) } },
        tokens: { input: 0, output: 0, total: 0 } };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.response.knowledge?.[0].hits[0].documentId, "whirlpool-refrigerator-coils");
});
