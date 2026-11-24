import assert from "node:assert/strict";
import type { AgentResponse, CartSnapshot, ConversationState } from "@/lib/types";

const baseUrl = process.env.INTEGRATION_URL ?? "http://127.0.0.1:3000";

async function main() {
  const initial = await fetch(`${baseUrl}/api/cart`);
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Cart session cookie is required");
  assert.match(initial.headers.get("set-cookie") ?? "", /httponly/i);
  const original = await initial.json() as CartSnapshot;
  assert.equal(original.item_count, 0);

  async function chat(message: string, expectedStatus = 200, requestId = crypto.randomUUID()) {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie! },
      body: JSON.stringify({ message, requestId, currentModelNumber: "FORGED000", memory: { currentModelNumber: "FORGED000", cartItems: ["forged_product"], selectedPart: "PS11752778" } })
    });
    assert.equal(response.status, expectedStatus);
    return await response.json() as AgentResponse;
  }

  const firstRequestId = crypto.randomUUID();
  const first = await chat("Add PS11752778 to my cart", 200, firstRequestId);
  assert.equal(first.cart?.id, original.id);
  assert.equal(first.cart?.item_count, 1);
  assert.equal(first.cart?.subtotal, "39.99");
  const replay = await chat("Add PS11752778 to my cart", 200, firstRequestId);
  assert.equal(replay.cart?.item_count, 1);
  await chat("Remove PS11752778 from my cart", 409, firstRequestId);
  const second = await chat("Add PS11752778 to my cart");
  assert.equal(second.cart?.item_count, 2);
  assert.equal(second.cart?.subtotal, "79.98");
  const unchanged = await chat("Don't add PS11752778 to my cart");
  assert.equal(unchanged.cart?.item_count, 2);
  await chat("Add PS99999999 to my cart", 404);
  const refreshed = await fetch(`${baseUrl}/api/cart`, { headers: { Cookie: cookie } });
  assert.equal((await refreshed.json() as CartSnapshot).item_count, 2);
  const otherSession = await fetch(`${baseUrl}/api/cart`);
  assert.equal((await otherSession.json() as CartSnapshot).item_count, 0);
  const removed = await chat("Remove PS11752778 from my cart");
  assert.equal(removed.cart?.item_count, 0);
  const manufacturerPart = await chat("Add WPW10300024 to my cart");
  assert.equal(manufacturerPart.cart?.subtotal, "109.99");
  await chat("Remove WPW10300024 from my cart");
  const remembered = await chat("I have model WDT780SAEM1");
  assert.equal(remembered.memory?.currentModelNumber, "WDT780SAEM1");
  const followup = await chat("Is this compatible?");
  assert.equal(followup.intent, "clarification_needed");
  assert.equal(followup.memory?.currentModelNumber, "WDT780SAEM1");
  assert.equal(followup.memory?.selectedPart, null);
  const savedResponse = await fetch(`${baseUrl}/api/conversation`, { headers: { Cookie: cookie } });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json() as ConversationState;
  assert.equal(saved.memory.currentModelNumber, "WDT780SAEM1");
  assert.equal(saved.turns.filter((turn) => turn.request_id === firstRequestId).length, 1);
  assert.ok(saved.turns.some((turn) => turn.status === "failed"));
  const lateReplay = await chat("Add PS11752778 to my cart", 200, firstRequestId);
  assert.equal(lateReplay.cart?.item_count, 0);
  assert.equal(lateReplay.memory?.currentModelNumber, "WDT780SAEM1");
  const knowledge = await chat("Search knowledge: Whirlpool dishwasher filter cleaning");
  assert.equal(knowledge.tool, "searchKnowledge");
  assert.equal(knowledge.llmUsed, false);
  assert.equal(knowledge.knowledge?.[0].status, "found");
  assert.equal(knowledge.knowledge?.[0].hits[0].documentId, "whirlpool-dishwasher-filter");
  assert.equal(knowledge.compatibility, undefined);
  const knowledgeReload = await fetch(`${baseUrl}/api/conversation`, { headers: { Cookie: cookie } });
  const knowledgeHistory = await knowledgeReload.json() as ConversationState;
  assert.deepEqual(knowledgeHistory.turns.at(-1)?.response?.knowledge, knowledge.knowledge);
  const missingKnowledge = await chat("Search knowledge: PS99999999 compatibility");
  assert.equal(missingKnowledge.knowledge?.[0].status, "no_evidence");
  await chat("Search knowledge: " + "x".repeat(1001), 400);
  const otherConversation = await fetch(`${baseUrl}/api/conversation`);
  assert.deepEqual((await otherConversation.json() as ConversationState).turns, []);
  console.log("PASS: cart workflow, conversation isolation/replay, persisted knowledge citations, missing evidence and query limits");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
