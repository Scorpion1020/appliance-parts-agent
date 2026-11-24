import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { evaluateCompatibility, evidenceFromProduct } from "@/lib/agent/compatibilityEvidence";
import { checkCompatibility } from "@/lib/agent/tools/compatibility";
import { extractPartData } from "@/lib/web/extractPartData";
import { fetchPartSelectPage } from "@/lib/web/partselectFetch";
import { normalizeAvailability, lookupLivePart } from "@/lib/web/grounding";
import { isPartSelectUrl } from "@/lib/web/sourceUrl";
import { products } from "@/data/products";
import type { CompatibilityEvidence } from "@/lib/types";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const part = "PS11752778";
const model = "WDT780SAEM1";
// 以下记录为合成测试证据，不代表已在线核实的真实配件关系。
const support: CompatibilityEvidence = {
  partNumber: part, modelNumber: model, verdict: "compatible", excerpt: model,
  source: { title: "Synthetic model list", url: `https://www.partselect.com/${part}.htm`, type: "compatibility", origin: "live" }
};

test("only exact matching live evidence supports a verdict", () => {
  assert.equal(evaluateCompatibility(part.toLowerCase(), ` ${model.toLowerCase()} `, [support]).status, "compatible");
  assert.equal(evaluateCompatibility(part, "WDT780SAEM2", [support]).status, "unknown");
  assert.equal(evaluateCompatibility("PS99999999", model, [support]).status, "unknown");
});

test("explicit exclusions and contradictory records remain distinct", () => {
  const exclusion: CompatibilityEvidence = { ...support, verdict: "incompatible", excerpt: `Explicit exclusion of ${model} (synthetic fixture)` };
  assert.equal(evaluateCompatibility(part, model, [exclusion]).status, "incompatible");
  const conflict = evaluateCompatibility(part, model, [support, exclusion]);
  assert.equal(conflict.status, "unknown");
  assert.equal(conflict.reason, "conflicting_evidence");
});

test("a missing model and a demo match do not become real compatibility claims", () => {
  assert.equal(evaluateCompatibility(part, model, [{ ...support, source: { ...support.source, origin: "demo" } }]).reason, "demo_only");
  assert.equal(checkCompatibility({ partNumber: part, modelNumber: model }).compatibility.reason, "no_evidence");
  assert.equal(checkCompatibility({ partNumber: part, modelNumber: "WDT780SAEM2" }).compatibility.status, "unknown");
  assert.equal(checkCompatibility({ partNumber: "PS99999999", modelNumber: model }).compatibility.status, "unknown");
});

test("model list absence never manufactures negative evidence", () => {
  const product = { ...products[0], compatibleModels: ["WDT780SAEM2"] };
  assert.deepEqual(evidenceFromProduct(product, part, model, support.source), []);
  assert.deepEqual(evidenceFromProduct(products[0], "PS99999999", model, support.source), []);
});

test("reviewed evidence expires and cannot override a conflicting live exclusion", () => {
  const record: CompatibilityEvidence = { ...support, source: { ...support.source, origin: "reviewed", retrievedAt: new Date().toISOString() } };
  assert.equal(evaluateCompatibility(part, model, [record]).status, "compatible");
  assert.equal(evaluateCompatibility(part, model, [record, { ...support, verdict: "incompatible" }]).reason, "conflicting_evidence");
  for (const date of ["2020-01-01", "invalid", "2099-01-01"]) {
    assert.equal(evaluateCompatibility(part, model, [{ ...record, source: { ...record.source, retrievedAt: date } }]).status, "unknown");
  }
});

test("untrusted source hosts and empty excerpts cannot justify a verdict", () => {
  for (const url of ["https://partselect.com.evil.example/", "http://www.partselect.com/", "https://www.partselect.com@evil.example/", "https://evil.example/?url=partselect.com", "javascript:alert(1)"]) {
    assert.equal(isPartSelectUrl(url), false);
    assert.equal(evaluateCompatibility(part, model, [{ ...support, source: { ...support.source, url } }]).status, "unknown");
  }
  assert.equal(evaluateCompatibility(part, model, [{ ...support, excerpt: " " }]).status, "unknown");
});

test("extractor accepts alphanumeric models only inside the model list", () => {
  const html = `<a>${model}</a><div id="ModelCrossReference"><div class="pd__crossref__list"><a>WDT780SAEM2</a><a>12345678</a><a>View more</a></div></div><a>WDT780SAEM3</a>`;
  assert.deepEqual(extractPartData(html, support.source.url).compatibleModels, ["WDT780SAEM2", "12345678"]);
});

test("a price elsewhere on the page is not a product price", () => {
  assert.equal(extractPartData("<p>Free shipping over $50</p>", support.source.url).price, null);
  assert.equal(extractPartData('<span itemprop="price" content="39.99"></span>', support.source.url).price, 39.99);
  assert.equal(extractPartData('<span data-price="39.9.9"></span>', support.source.url).price, null);
});

test("script and comment markup is not compatibility evidence", () => {
  const html = `<div id="ModelCrossReference"><div class="pd__crossref__list"><script>const hidden='<a>${model}</a>';</script><!-- <a>${model}</a> --><a>WDT780SAEM2</a></div></div>`;
  assert.deepEqual(extractPartData(html, support.source.url).compatibleModels, ["WDT780SAEM2"]);
});

test("unknown inventory is not silently turned into in-stock", () => {
  for (const value of [null, "", "Backordered", "Not in stock", "Call for availability"]) assert.equal(normalizeAvailability(value), "Unknown");
  assert.equal(normalizeAvailability("OutOfStock"), "Out of stock");
  assert.equal(normalizeAvailability("In stock"), "In stock");
});

test("source page fetch rejects foreign hosts before making a request", async () => {
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  await assert.rejects(fetchPartSelectPage("https://evil.example/partselect.com"), /Only HTTPS PartSelect/);
});

test("an exact part lookup never accepts a different product page", async () => {
  const requested = "PS88888888";
  globalThis.fetch = async (url) => {
    const address = String(url);
    if (address.includes("Sitemap_Master")) return new Response('<loc>https://www.partselect.com/PartDetail-test.xml</loc>');
    if (address.endsWith(".xml")) return new Response(`<loc>https://www.partselect.com/${requested}-Dishwasher.htm</loc>`);
    if (address.includes(`${requested}-Dishwasher`)) return new Response(`<title>Dishwasher gasket</title><span itemprop="productID">PS99999999</span><span data-price="10" data-availability="InStock"></span>`);
    throw new Error(`Unexpected test URL: ${address}`);
  };
  const result = await lookupLivePart(requested);
  assert.equal(result.product, null);
  assert.equal(result.status, "demo_fallback");
});
