import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBubble } from "@/components/MessageBubble";
import { ProductCard } from "@/components/ProductCard";
import { products } from "@/data/products";
import { checkCompatibility } from "@/lib/agent/tools/compatibility";
import { buildCompatibilityMessage } from "@/lib/agent/prompts";
import { executeAgent } from "@/lib/agent/executor";
import { parseCartCommand } from "@/lib/agent/tools/cart";

test("Chinese interactions preserve user text, stock status and model context", async () => {
  const text = "What does Unknown mean?";
  const html = renderToStaticMarkup(createElement(MessageBubble, {
    message: { id: "user", role: "user", content: text }, onCheckCompatibility() {}, onViewInstallationGuide() {}
  }));
  assert.ok(html.includes(text));
  assert.match(renderToStaticMarkup(createElement(ProductCard, { product: { ...products[0], availability: "Out of stock" } })), /缺货/);
  const result = await executeAgent({ message: "型号改成ADB1500ADB99", memory: { currentModelNumber: "WSF26C3EXF01" } });
  assert.equal(result.memory.currentModelNumber, "ADB1500ADB99");
  assert.equal(parseCartCommand("从购物车移除 PS11752778")?.action, "remove");
  assert.equal(parseCartCommand("不要从购物车移除 PS11752778"), null);
});

test("unknown compatibility is not rendered as an incompatible badge", () => {
  const result = checkCompatibility({ partNumber: "PS11752778", modelNumber: "WDT780SAEM1" });
  const html = renderToStaticMarkup(createElement(MessageBubble, {
    message: {
      id: "fixture", role: "assistant", content: buildCompatibilityMessage(result.compatibility),
      response: { message: "", intent: "compatibility_check", tool: "checkCompatibility", groundingStatus: "demo_fallback",
        products: [products[0]], compatibility: result.compatibility, sources: result.compatibility.evidence.map((item) => item.source) }
    }, onCheckCompatibility() {}, onViewInstallationGuide() {}
  }));
  assert.match(html, /适配情况未知/);
  assert.match(html, /演示数据/);
  assert.match(html, /暂无法核实/);
  assert.doesNotMatch(html, /仅供演示/);
  assert.doesNotMatch(html, />不适配<|已由 PartSelect 核实/);
});

test("missing price and inventory remain visible as unknown", () => {
  const html = renderToStaticMarkup(createElement(ProductCard, { product: { ...products[0], price: null, availability: "Unknown" } }));
  assert.match(html, /尚未核实/);
  assert.match(html, /未核实/);
  assert.doesNotMatch(html, /\$0\.00|>有货</);
});
