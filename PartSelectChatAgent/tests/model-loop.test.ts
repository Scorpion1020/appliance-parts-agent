import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { executeModelLoop } from "@/lib/agent/model-loop";
import { callToolModel, parseModelReply, type ModelReply, type ToolModel } from "@/lib/agent/model-provider";
import { modelTools, validateReadArguments } from "@/lib/agent/model-tools";
import { createConversationMemory } from "@/lib/agent/memory";
import { executeAgent } from "@/lib/agent/executor";
import { evaluateCompatibility } from "@/lib/agent/compatibilityEvidence";
import { ShoppingError } from "@/lib/shopping";
import type { AgentResponse } from "@/lib/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "@/components/MessageBubble";

const savedFetch = globalThis.fetch;
const savedKey = process.env.OPENAI_API_KEY;
const savedMode = process.env.AGENT_EXECUTION_MODE;
afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey;
  if (savedMode === undefined) delete process.env.AGENT_EXECUTION_MODE; else process.env.AGENT_EXECUTION_MODE = savedMode;
});
const input = { message: "Check PS11752778 for WDT780SAEM1", memory: createConversationMemory() };
const lookup: AgentResponse = { intent: "part_lookup", tool: "searchProducts", message: "Catalog result", products: [], groundingStatus: "demo_fallback" };
const compatibility: AgentResponse = { intent: "compatibility_check", tool: "checkCompatibility", message: "Compatibility is unknown.",
  compatibility: evaluateCompatibility("PS11752778", "WDT780SAEM1", []), groundingStatus: "unverified" };
function reply(id: string, name: string, args: unknown): ModelReply {
  return { call: { id, type: "function", function: { name, arguments: JSON.stringify(args) } }, tokens: { input: 10, output: 5, total: 15 } };
}
function sequence(replies: ModelReply[]): ToolModel {
  let index = 0;
  return async () => { assert.ok(index < replies.length, "unexpected model call"); return replies[index++]; };
}
const finish = (ids: string[], missing = "none") => reply("done", "finish", { resultIds: ids, missing });

test("known model blocks premature proposal before an unknown compatibility check", async () => {
  const executed: string[] = [];
  const result = await executeModelLoop(input, {
    model: sequence([
      reply("premature", "prepareCartAddition", { partNumber: "PS11752778", quantity: "1" }),
      reply("fit", "checkCompatibility", { partNumber: "PS11752778", modelNumber: "WDT780SAEM1" }),
      finish(["fit"])
    ]),
    runTool: async name => { executed.push(name); return compatibility; }
  });
  assert.deepEqual(executed, ["checkCompatibility"]);
  assert.equal(result.response.cartProposal, undefined);
  assert.equal(result.response.trace![0].status, "error");
});

test("mixed tool findings remain visible even when the final intent is compatibility", async () => {
  const result = await executeModelLoop(input, {
    model: sequence([
      reply("install", "getInstallationGuide", { partNumber: "PS11752778" }),
      reply("fit", "checkCompatibility", { partNumber: "PS11752778", modelNumber: "WDT780SAEM1" }),
      finish(["install", "fit"])
    ]),
    runTool: async (name) => name === "getInstallationGuide"
      ? { intent: "installation_guide", tool: name, message: "Demo steps for PS11752778", steps: ["Disconnect power before inspection."] }
      : compatibility
  });
  const html = renderToStaticMarkup(createElement(MessageBubble, {
    message: { id: "mixed", role: "assistant", content: result.response.message, response: result.response },
    onViewInstallationGuide: () => {}, onCheckCompatibility: () => {}
  }));
  assert.match(html, /Disconnect power before inspection/);
  assert.match(html, /Demo steps for PS11752778/);
  assert.match(html, /查看执行过程/);
  assert.equal(result.response.steps, undefined);
});

test("explicit addition stays read-only in model mode until confirmation", async () => {
  process.env.AGENT_EXECUTION_MODE = "tool_loop";
  let writes = 0;
  globalThis.fetch = async (url, init) => {
    assert.ok(!String(url).includes("api.openai.com"));
    if (init?.method === "POST") {
      writes++;
      assert.equal(new Headers(init.headers).get("X-Conversation-Token"), "lease");
    }
    return Response.json({ id: "PS11752778", name: "Door bin", category: "refrigerator", price: "39.99", currency: "USD", available: true, stock_qty: null, symptoms: [] });
  };
  const result = await executeAgent({ message: "Add PS11752778 to my cart", cartId: "cart_test", requestId: "write", turnToken: "lease" });
  assert.equal(writes, 0);
  assert.equal(result.response.cartProposal?.partNumber, "PS11752778");
  assert.equal(result.response.llmUsed, false);
});

test("model consumes tool output and chooses a second tool before finishing", async () => {
  let calls = 0;
  const result = await executeModelLoop(input, {
    model: async (messages) => {
      calls++;
      if (calls === 1) return reply("search", "searchProducts", { query: "PS11752778" });
      const toolMessage = JSON.parse(messages.at(-1)!.content!);
      if (calls === 2) {
        assert.equal(toolMessage.resultId, "search");
        assert.equal(toolMessage.result.message, "Catalog result");
        return reply("fit", "checkCompatibility", { partNumber: "PS11752778", modelNumber: "WDT780SAEM1" });
      }
      assert.equal(toolMessage.result.compatibility.status, "unknown");
      return finish(["search", "fit"]);
    },
    runTool: async (name) => name === "searchProducts" ? lookup : compatibility
  });
  assert.equal(calls, 3);
  assert.match(result.response.message, /unknown/);
  assert.equal(result.response.llmUsed, true);
  assert.equal(result.response.tokens?.total, 45);
  assert.deepEqual(result.response.trace?.map((step) => step.status), ["ok", "ok", "ok"]);
  assert.equal(result.memory.currentModelNumber, "WDT780SAEM1");
  assert.equal(result.memory.selectedPart, "PS11752778");
});

test("unknown write tools and prototype names cannot reach the tool runner", async () => {
  let executed = 0;
  const result = await executeModelLoop(input, {
    model: sequence([reply("write", "addToCart", { partNumber: "PS11752778" }), reply("proto", "constructor", {}), finish([], "part")]),
    runTool: async () => { executed++; return lookup; }
  });
  assert.equal(executed, 0);
  assert.deepEqual(result.response.trace?.map((step) => step.status), ["error", "error", "ok"]);
  assert.equal(modelTools.some((tool) => tool.function.name === "addToCart"), false);
});

test("hallucinated model identifiers are rejected before lookup", async () => {
  let executed = false;
  const result = await executeModelLoop(input, {
    model: sequence([reply("bad", "checkCompatibility", { partNumber: "PS11752778", modelNumber: "FAKE999999" }), finish([], "model")]),
    runTool: async () => { executed = true; return compatibility; }
  });
  assert.equal(executed, false);
  assert.match(result.response.trace![0].error!, /Model number must come/);
});

test("finish cannot hide an unknown compatibility result", async () => {
  const result = await executeModelLoop(input, {
    model: sequence([reply("fit", "checkCompatibility", { partNumber: "PS11752778", modelNumber: "WDT780SAEM1" }),
      reply("omit", "finish", { resultIds: [], missing: "part" }), finish(["fit"])]),
    runTool: async () => compatibility
  });
  assert.equal(result.response.trace![1].status, "error");
  assert.equal(result.response.compatibility?.status, "unknown");
  assert.match(result.response.message, /unknown/);
});

test("duplicate requests do not rerun the tool and error feedback allows recovery", async () => {
  let executed = 0;
  const result = await executeModelLoop(input, {
    model: sequence([reply("one", "searchProducts", { query: "gasket" }), reply("two", "searchProducts", { query: "gasket" }), finish(["one"])]),
    runTool: async () => { executed++; return lookup; }
  });
  assert.equal(executed, 1);
  assert.equal(result.response.trace![1].status, "error");
});

test("malformed arguments can be corrected without executing the bad call", async () => {
  const malformed = reply("bad", "searchProducts", {});
  malformed.call.function.arguments = "{";
  const result = await executeModelLoop(input, {
    model: sequence([malformed, reply("good", "searchProducts", { query: "PS11752778" }), finish(["good"])]),
    runTool: async () => lookup
  });
  assert.equal(result.response.trace![0].error, "Invalid JSON arguments.");
  assert.equal(result.response.trace![1].status, "ok");
});

test("six-step budget terminates a model that never finishes", async () => {
  let calls = 0;
  await assert.rejects(executeModelLoop(input, {
    model: async () => reply(String(++calls), "searchProducts", { query: "gasket" }),
    runTool: async () => lookup
  }), (error: unknown) => error instanceof ShoppingError && error.code === "agent_step_limit");
  assert.equal(calls, 6);
});

test("reused call IDs fail closed", async () => {
  await assert.rejects(executeModelLoop(input, {
    model: sequence([reply("same", "searchProducts", { query: "gasket" }), reply("same", "finish", { resultIds: ["same"], missing: "none" })]),
    runTool: async () => lookup
  }), (error: unknown) => error instanceof ShoppingError && error.code === "model_protocol_error");
});

test("strict runtime validation rejects extra fields and invalid identifiers", () => {
  assert.throws(() => validateReadArguments("searchProducts", { query: "gasket", cartId: "injected" }));
  assert.throws(() => validateReadArguments("checkCompatibility", { partNumber: "PS11752778", modelNumber: "" }));
  assert.throws(() => validateReadArguments("checkCompatibility", { partNumber: "PS11752778", modelNumber: "unknown" }));
  assert.throws(() => validateReadArguments("searchProducts", { query: "x".repeat(1001) }));
  assert.throws(() => validateReadArguments("getInstallationGuide", { partNumber: "PS112" }));
  assert.deepEqual(validateReadArguments("checkCompatibility", { partNumber: "ps11752778", modelNumber: "wdt780saem1" }), { partNumber: "PS11752778", modelNumber: "WDT780SAEM1" });
});

test("provider uses strict serial function calling and never sends memory as instructions", async () => {
  process.env.OPENAI_API_KEY = "test-not-a-real-key";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tool_choice, "required");
    assert.equal(body.store, false);
    assert.equal(body.tools[0].function.strict, true);
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [finish([], "part").call] } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  };
  const result = await callToolModel([{ role: "user", content: "Which part?" }], modelTools, new AbortController().signal);
  assert.equal(result.call.function.name, "finish");
  assert.equal(result.tokens.total, 15);
});

test("provider refuses free text, parallel calls, truncated outputs and missing configuration", async () => {
  assert.throws(() => parseModelReply({ choices: [{ finish_reason: "stop", message: { content: "It fits!" } }] }));
  assert.throws(() => parseModelReply({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [finish([], "part").call, finish([], "part").call] } }] }));
  assert.throws(() => parseModelReply({ choices: [{ finish_reason: "length", message: { tool_calls: [finish([], "part").call] } }] }));
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(callToolModel([], modelTools, new AbortController().signal),
    (error: unknown) => error instanceof ShoppingError && error.code === "model_not_configured");
});

test("public executor enters configured model mode without keyword-selected tools", async () => {
  process.env.AGENT_EXECUTION_MODE = "tool_loop";
  process.env.OPENAI_API_KEY = "test-not-a-real-key";
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: { tool_calls: [finish([], "part").call] } }] });
  };
  const result = await executeAgent({ message: "Could you help me choose?", memory: createConversationMemory() });
  assert.equal(result.response.executionMode, "tool_loop");
  assert.equal(result.response.intent, "clarification_needed");
  assert.equal(result.response.trace?.length, 1);
});
