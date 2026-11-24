import { products } from "@/data/products";
import { executeAgent } from "@/lib/agent/executor";
import { setCache } from "@/lib/cache";
import { evidenceCases } from "@/evals/evidenceCases";

async function main() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Offline evaluation must not use external services"); };
  const rows = [];
  try {
    for (const task of evidenceCases) {
      const product = { ...products[0], partNumber: task.live === "wrong_part" ? "PS99999999" : products[0].partNumber,
        compatibleModels: task.live === "missing_model" ? [] : products[0].compatibleModels };
      setCache("live-part:ps11752778", {
        status: task.live === "unavailable" ? "demo_fallback" : "verified_live",
        product: task.live === "unavailable" ? null : product,
        sources: task.live === "unavailable" ? [] : [{ title: "Synthetic evaluation model list", url: product.sourceUrl, type: "compatibility", origin: "live", retrievedAt: "2026-09-28T00:00:00Z" }]
      });
      const started = performance.now();
      const { response } = await executeAgent({ message: task.query });
      const passed = response.intent === task.expectedIntent && response.compatibility?.status === task.expectedStatus
        && response.compatibility?.reason === task.expectedReason && response.llmUsed === false
        && (response.compatibility?.status !== "unknown" || !/is not compatible|are not compatible|is compatible with/i.test(response.message))
        && (response.compatibility?.status !== "compatible" || response.compatibility.evidence.some((item) => item.source.origin === "live"));
      rows.push({ name: task.name, passed, intent: response.intent, status: response.compatibility?.status ?? null, latencyMs: Math.round(performance.now() - started) });
    }
  } finally { globalThis.fetch = originalFetch; }
  const passed = rows.filter((row) => row.passed).length;
  console.log(JSON.stringify({ scope: "Offline synthetic executor regression, not real-world task success rate", total: rows.length, passed, failed: rows.length - passed, rows }, null, 2));
  if (passed !== rows.length) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
