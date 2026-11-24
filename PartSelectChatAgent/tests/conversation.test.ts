import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runConversationTurn } from "@/lib/conversation";
import { createConversationMemory, mergeConversationMemory, updateMemoryForModel } from "@/lib/agent/memory";
import { executeAgent } from "@/lib/agent/executor";
import { updateCart } from "@/lib/agent/tools/cart";
import { recentlyViewedFromHistory, restoreMessages } from "@/lib/conversation-view";
import { ShoppingError } from "@/lib/shopping";
import type { AgentResponse, ConversationState } from "@/lib/types";
import { createHash } from "node:crypto";
import { evaluateCompatibility } from "@/lib/agent/compatibilityEvidence";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const savedMemory = { ...createConversationMemory(), currentModelNumber: "WDT780SAEM1" };
const response: AgentResponse = { message: "Saved model", intent: "context_update", tool: "updateContext", llmUsed: false };

test("later unknown compatibility invalidates an earlier confirmation button", async () => {
  let productOrCartAccess = false;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/fail")) return Response.json({});
    if (!String(url).endsWith("/turns")) { productOrCartAccess = true; throw new Error("Must reject before cart access"); }
    return Response.json({ replayed: false, token: "lease", memory: savedMemory, version: 2, turns: [
      { request_id: "proposal", status: "completed", response: { ...response,
        cartProposal: { partNumber: "PS11752778", quantity: 1, name: "Part", unitPrice: 39.99 } } },
      { request_id: "check", status: "completed", response: { ...response,
        compatibility: evaluateCompatibility("PS11752778", "WDT780SAEM1", []) } }
    ] });
  };
  await assert.rejects(runConversationTurn({ cartId: "cart_test", message: "Confirm cart proposal proposal",
    requestId: "confirm-" + createHash("sha256").update("proposal").digest("hex") }),
    (error: unknown) => error instanceof ShoppingError && error.code === "proposal_conflict");
  assert.equal(productOrCartAccess, false);
});

test("turn execution receives server memory and saves the returned state", async () => {
  let completed = false;
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (init?.method === "POST") {
      assert.deepEqual(payload, { request_id: "turn", message: "Model update" });
      return Response.json({ memory: savedMemory, version: 1, turns: [], replayed: false, token: "server-token" });
    }
    assert.equal(init?.method, "PUT");
    assert.equal(payload.token, "server-token");
    assert.equal(payload.memory.currentModelNumber, "WDT780SAEM2");
    assert.equal(payload.response.memory.currentModelNumber, "WDT780SAEM2");
    completed = true;
    return Response.json({});
  };
  const result = await runConversationTurn({ cartId: "cart_test", requestId: "turn", message: "Model update" }, async (input) => {
    assert.deepEqual(input.memory, savedMemory);
    assert.equal(input.turnToken, "server-token");
    return { memory: savedMemory, response: { ...response, memory: { currentModelNumber: "WDT780SAEM2" } } };
  });
  assert.equal(completed, true);
  assert.equal(result.memory?.currentModelNumber, "WDT780SAEM2");
});

test("changing the model invalidates a saved proposal before product or cart access", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/fail")) return Response.json({});
    assert.ok(String(url).endsWith("/turns"));
    return Response.json({ replayed: false, token: "lease", memory: savedMemory, version: 2, turns: [
      { request_id: "proposal", status: "completed", response: { ...response, cartProposal: {
        partNumber: "PS11752778", quantity: 1, name: "Part", unitPrice: 39.99,
        modelNumber: "WSF26C3EXF01", applianceType: "refrigerator"
      } } }
    ] });
  };
  await assert.rejects(runConversationTurn({ cartId: "cart_test", message: "Confirm cart proposal proposal",
    requestId: "confirm-" + createHash("sha256").update("proposal").digest("hex") }),
    (error: unknown) => error instanceof ShoppingError && error.code === "proposal_context_changed");
});

test("completed turns replay without invoking the executor", async () => {
  globalThis.fetch = async () => Response.json({ replayed: true, response, memory: savedMemory, version: 1, turns: [] });
  const replay = await runConversationTurn({ cartId: "cart_test", requestId: "turn", message: "Same message" }, async () => { throw new Error("Must not execute twice"); });
  assert.equal(replay.message, response.message);
  assert.equal(replay.memory?.currentModelNumber, savedMemory.currentModelNumber);
});

test("busy sessions do not invoke the executor", async () => {
  globalThis.fetch = async () => Response.json({ error: { code: "conversation_busy", message: "Busy" } }, { status: 409 });
  await assert.rejects(runConversationTurn({ cartId: "cart_test", requestId: "turn", message: "Hello" }, async () => { throw new Error("Must not execute"); }), (error: unknown) => error instanceof ShoppingError && error.code === "conversation_busy");
});

test("failed execution releases its own lease without saving false success", async () => {
  let recorded = false;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/fail")) {
      assert.equal(JSON.parse(String(init?.body)).token, "owned-token");
      recorded = true;
      return Response.json({ status: "recorded" });
    }
    assert.notEqual(init?.method, "PUT");
    return Response.json({ replayed: false, token: "owned-token", memory: savedMemory, version: 1, turns: [] });
  };
  await assert.rejects(runConversationTurn({ cartId: "cart_test", requestId: "turn", message: "Hello" }, async () => { throw new Error("Tool failed"); }), /Tool failed/);
  assert.equal(recorded, true);
});

test("cart writes carry the server-owned conversation token", async () => {
  const cart = { id: "cart_test", items: [], item_count: 0, subtotal: "0", currency: null };
  let written = false;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "DELETE") {
      const headers = new Headers(init.headers);
      assert.equal(headers.get("X-Conversation-Request"), "turn");
      assert.equal(headers.get("X-Conversation-Token"), "server-token");
      written = true;
    }
    return Response.json(cart);
  };
  await updateCart({ cartId: "cart_test", requestId: "turn", turnToken: "server-token", action: "remove", partNumber: "PS11752778" });
  assert.equal(written, true);
});

test("explicit clearing and model switches remove stale diagnostic context", () => {
  const previous = { ...savedMemory, selectedPart: "PS11752778", previousTroubleshootingTopic: "leak", troubleshootingContext: ["old advice"] };
  assert.equal(mergeConversationMemory(previous, { selectedPart: null }).selectedPart, null);
  const switched = updateMemoryForModel(previous, " wdt780saem2 ");
  assert.equal(switched.currentModelNumber, "WDT780SAEM2");
  assert.equal(switched.previousTroubleshootingTopic, null);
  assert.deepEqual(switched.troubleshootingContext, []);
  assert.equal(switched.selectedPart, "PS11752778");
});

test("saved history restores stable IDs and interrupted requests", () => {
  const state: ConversationState = { memory: savedMemory, version: 1, turns: [
    { request_id: "first", message: "My model", status: "completed", response, error: null, started_at: 1 },
    { request_id: "second", message: "Next", status: "failed", response: null, error: "Tool unavailable", started_at: 2 }
  ] };
  const messages = restoreMessages(state);
  assert.deepEqual(messages.map((item) => item.id), ["first-user", "first-assistant", "second-user", "second-error"]);
  assert.equal(messages[3].content, "Tool unavailable");
  assert.deepEqual(recentlyViewedFromHistory(state), []);
});

test("out of scope requests remain read-free and model-free", async () => {
  globalThis.fetch = async () => { throw new Error("No external calls allowed"); };
  const result = await executeAgent({ message: "What is the weather tomorrow?", memory: savedMemory });
  assert.equal(result.response.intent, "out_of_scope");
  assert.equal(result.response.llmUsed, false);
});
