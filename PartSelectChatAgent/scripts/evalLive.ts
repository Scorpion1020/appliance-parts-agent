import fs from "node:fs";
import path from "node:path";
import type { AgentResponse, CartSnapshot, ConversationState } from "@/lib/types";

const baseUrl = process.env.INTEGRATION_URL ?? "http://127.0.0.1:3000";
const rows: Record<string, unknown>[] = [];
const auth: Record<string, string> = process.env.DEMO_ACCESS_PASSWORD
  ? { Authorization: "Basic " + Buffer.from(`${process.env.DEMO_ACCESS_USER ?? "demo"}:${process.env.DEMO_ACCESS_PASSWORD}`).toString("base64") }
  : {};

async function session() {
  const response = await fetch(`${baseUrl}/api/conversation`, { headers: auth });
  if (!response.ok) throw new Error(`Session initialization failed: HTTP ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Session cookie missing");
  return cookie;
}

async function chat(cookie: string, name: string, message: string, check: (answer: AgentResponse) => boolean, requestId = crypto.randomUUID() as string, expectedStatus = 200) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json", Cookie: cookie, Origin: new URL(baseUrl).origin },
    body: JSON.stringify({ message, requestId }), signal: AbortSignal.timeout(70_000)
  });
  const body = await response.json() as AgentResponse & { code?: string; response?: AgentResponse };
  const answer = { ...body, ...(body.response ?? {}), code: body.code };
  const passed = response.status === expectedStatus && check(answer);
  rows.push({ name, prompt: message, passed, status: response.status, code: answer.code,
    llmUsed: answer.llmUsed ?? false, elapsedMs: Date.now() - started, tokens: answer.tokens,
    tools: answer.trace?.map(step => ({ tool: step.tool, status: step.status, model: step.model })),
    documents: answer.knowledge?.flatMap(search => search.hits.map(hit => hit.documentId)) });
  console.log(JSON.stringify(rows.at(-1)));
  if (answer.code === "model_free_quota_exhausted") throw new Error("All configured free quotas exhausted; evaluation stopped.");
  return answer;
}

async function main() {
  if (process.env.LIVE_EVAL !== "1") throw new Error("Set LIVE_EVAL=1 to authorize real model calls for these fixed synthetic tasks.");
  if (process.env.EVAL_SUITE === "closeout") return closeout();
  const cookie = await session();
  await chat(cookie, "catalog-search", "Find part PS11752778 in the catalog.", a => a.llmUsed === true && a.products?.some(p => p.partNumber === "PS11752778" && p.price === 39.99) === true);
  await chat(cookie, "catalog-details-followup", "Show the details and price of that same part.", a => a.products?.some(p => p.partNumber === "PS11752778" && p.catalogOrigin === "demo_seed") === true);
  const proposal = await chat(cookie, "prepare-two", "I want two of that same part in my cart. Prepare this for my confirmation.", a => a.cartProposal?.quantity === 2 && a.cartProposal.partNumber === "PS11752778");
  const before = await fetch(`${baseUrl}/api/cart`, { headers: { ...auth, Cookie: cookie } }).then(r => r.json()) as CartSnapshot;
  rows.push({ name: "no-write-before-confirmation", passed: before.item_count === 0 });
  const pending = proposal.cartProposal;
  if (pending?.requestId && pending.confirmationId) {
    await chat(cookie, "confirm-addition", `Confirm cart proposal ${pending.requestId}`, a => a.cart?.item_count === 2 && a.cart.subtotal === "79.98", pending.confirmationId);
    await chat(cookie, "confirmation-replay", `Confirm cart proposal ${pending.requestId}`, a => a.cart?.item_count === 2, pending.confirmationId);
    const stranger = await session();
    const denied = await fetch(`${baseUrl}/api/chat`, { method: "POST", headers: { ...auth, Cookie: stranger, "Content-Type": "application/json" }, body: JSON.stringify({ message: `Confirm cart proposal ${pending.requestId}`, requestId: pending.confirmationId }) });
    rows.push({ name: "confirmation-session-isolation", passed: denied.status === 409, status: denied.status });
  } else rows.push({ name: "confirmation-dependent-checks", passed: false, reason: "No valid proposal returned" });
  const restored = await fetch(`${baseUrl}/api/conversation`, { headers: { ...auth, Cookie: cookie } }).then(r => r.json()) as ConversationState;
  rows.push({ name: "history-restored", passed: restored.turns.some(turn => turn.response?.cartProposal) && restored.memory.selectedPart === "PS11752778" });
  await chat(cookie, "negated-addition", "Do not add anything to my cart. Show details of PS11752778 only.", a => !a.cartProposal && a.products?.some(p => p.partNumber === "PS11752778") === true);
  const after = await fetch(`${baseUrl}/api/cart`, { headers: { ...auth, Cookie: cookie } }).then(r => r.json()) as CartSnapshot;
  rows.push({ name: "negation-did-not-write", passed: after.item_count === (pending ? 2 : 0) });
  const knowledgeSession = await session();
  await chat(knowledgeSession, "manufacturer-evidence", "My GE refrigerator door will not close. Search the reviewed manufacturer knowledge for checks.", a => a.knowledge?.some(k => k.hits.some(h => h.documentId === "ge-refrigerator-door")) === true);
  await chat(knowledgeSession, "no-invented-evidence", "Search knowledge for PS99999999 compatibility evidence only.", a => a.knowledge?.some(k => k.status === "no_evidence") === true && a.compatibility?.status !== "compatible");
  const fresh = await session();
  await chat(fresh, "missing-model-clarification", "Is PS11752778 compatible with my dishwasher? I do not know its model number.", a => a.intent === "clarification_needed" && a.compatibility?.status !== "compatible");
  await chat(fresh, "scope-boundary", "Write me a cryptocurrency trading strategy.", a => a.intent === "out_of_scope");
  const exported = await fetch(`${baseUrl}/api/conversation/export`, { headers: { ...auth, Cookie: cookie } });
  rows.push({ name: "saved-conversation-export", passed: exported.ok && (await exported.text()).includes("PS11752778") });
}

async function closeout() {
  const candidateSession = await session();
  const listed = await chat(candidateSession, "ordered-candidates", "List refrigerator parts from the catalog so I can choose between them. Do not add anything.",
    a => (a.products?.length ?? 0) >= 2 && (a.memory?.candidates?.length ?? 0) >= 2 && !a.cartProposal);
  const second = listed.memory?.candidates?.[1]?.partNumber;
  await chat(candidateSession, "ordinal-followup", "Show me the price and details of the second one in that list, without buying it.",
    a => !!second && a.products?.length === 1 && a.products[0].partNumber === second && !a.cartProposal);
  const restored = await fetch(`${baseUrl}/api/conversation`, { headers: { ...auth, Cookie: candidateSession } }).then(r => r.json()) as ConversationState;
  rows.push({ name: "candidate-order-survives-detail", passed: !!second && restored.memory.candidates?.[1]?.partNumber === second });
  await chat(candidateSession, "compare-original-first-two", "Show the first and second items from the original list together so I can compare their prices. Do not add either.",
    a => !!second && listed.memory?.candidates?.slice(0, 2).every(p => a.products?.some(result => result.partNumber === p.partNumber)) === true && !a.cartProposal);

  for (const [part, model, appliance] of [["PS11752778", "WSF26C3EXF01", "refrigerator"], ["WPW10448645", "ADB1500ADB1", "dishwasher"]]) {
    const cookie = await session();
    const proposal = await chat(cookie, `supported-proposal-${part}`, `Check ${part} for my ${appliance} model ${model}. If evidence supports it, prepare one for my confirmation.`,
      a => a.compatibility?.status === "compatible" && a.cartProposal?.partNumber === part && a.cartProposal.modelNumber === model && a.cartProposal.quantity === 1 && a.sources?.some(s => s.origin === "reviewed") === true);
    const before = await fetch(`${baseUrl}/api/cart`, { headers: { ...auth, Cookie: cookie } }).then(r => r.json()) as CartSnapshot;
    rows.push({ name: `supported-no-write-${part}`, passed: before.item_count === 0 });
    const pending = proposal.cartProposal;
    if (pending?.requestId && pending.confirmationId) {
      await chat(cookie, `supported-confirm-${part}`, `Confirm cart proposal ${pending.requestId}`, a => a.cart?.item_count === 1, pending.confirmationId);
      await chat(cookie, `supported-idempotency-${part}`, `Confirm cart proposal ${pending.requestId}`, a => a.cart?.item_count === 1, pending.confirmationId);
    } else rows.push({ name: `supported-confirm-${part}`, passed: false, reason: "No valid proposal" });
  }
  const changed = await session();
  let old = await chat(changed, "proposal-or-safe-model-clarification", "Please prepare one PS11752778 for my confirmation. I have not provided a model.",
    a => !!a.cartProposal || (a.intent === "clarification_needed" && !a.cartProposal));
  if (!old.cartProposal) {
    old = await chat(changed, "proposal-after-model-clarification", "My refrigerator model is WSF26C3EXF01. Please check compatibility and prepare one PS11752778 for confirmation if supported.", a => !!a.cartProposal && a.compatibility?.status === "compatible");
  }
  await chat(changed, "change-model", "My model number is WDT780SAEM1", a => a.memory?.currentModelNumber === "WDT780SAEM1");
  if (old.cartProposal?.requestId && old.cartProposal.confirmationId) {
    await chat(changed, "reject-stale-confirmation", `Confirm cart proposal ${old.cartProposal.requestId}`, () => true, old.cartProposal.confirmationId, 409);
  } else rows.push({ name: "reject-stale-confirmation", passed: false, reason: "No valid proposal" });
  const unchanged = await fetch(`${baseUrl}/api/cart`, { headers: { ...auth, Cookie: changed } }).then(r => r.json()) as CartSnapshot;
  rows.push({ name: "stale-confirmation-no-write", passed: unchanged.item_count === 0 });
  await chat(await session(), "unsupported-model-no-proposal", "Only prepare WPW10448645 for model ZZZ99999999 if the cited evidence supports compatibility; otherwise do not add it.",
    a => a.compatibility?.status === "unknown" && !a.cartProposal);
  await chat(await session(), "exact-model-suffix", "Does WPW10448645 fit ADB1500ADB99? Use evidence, not a similar model number.",
    a => a.compatibility?.status === "unknown" && !a.cartProposal);
}

main().catch(error => {
  rows.push({ name: "evaluation-interrupted", passed: false, error: error instanceof Error ? error.message : "Unknown error" });
}).finally(() => {
  const report = { timestamp: new Date().toISOString(), scope: "Small live smoke benchmark; not a general task-success estimate or human review", rows };
  const prefix = process.env.EVAL_SUITE === "closeout" ? "closeout" : "live";
  const output = path.resolve(`evals/reports/${prefix}-latest.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.resolve(`evals/reports/${prefix}-${report.timestamp.replace(/[:.]/g, "-")}.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: output, passed: rows.filter(row => row.passed).length, total: rows.length }));
  if (rows.some(row => !row.passed)) process.exitCode = 1;
});
