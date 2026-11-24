import type { CompatibilityResult } from "@/lib/types";

// 合成的受控工具结果，用于评估执行器而非测量真实网站覆盖率。
export const evidenceCases: {
  name: string; query: string; live: "matching" | "missing_model" | "wrong_part" | "unavailable";
  expectedStatus?: CompatibilityResult["status"]; expectedReason?: CompatibilityResult["reason"];
  expectedIntent: "compatibility_check" | "clarification_needed";
}[] = [
  { name: "explicit-live-model", query: "Is PS11752778 compatible with WDT780SAEM1?", live: "matching", expectedStatus: "compatible", expectedReason: "supported", expectedIntent: "compatibility_check" },
  { name: "missing-model-is-not-negative", query: "Is PS11752778 compatible with WDT780SAEM1?", live: "missing_model", expectedStatus: "unknown", expectedReason: "no_evidence", expectedIntent: "compatibility_check" },
  { name: "demo-match-is-not-verified", query: "Is PS11752778 compatible with WDT780SAEM1?", live: "unavailable", expectedStatus: "unknown", expectedReason: "demo_only", expectedIntent: "compatibility_check" },
  { name: "wrong-product-rejected", query: "Is PS11752778 compatible with WDT780SAEM1?", live: "wrong_part", expectedStatus: "unknown", expectedReason: "demo_only", expectedIntent: "compatibility_check" },
  { name: "different-model-suffix", query: "Is PS11752778 compatible with WDT780SAEM2?", live: "matching", expectedStatus: "unknown", expectedReason: "no_evidence", expectedIntent: "compatibility_check" },
  { name: "missing-model-clarifies", query: "Is PS11752778 compatible?", live: "matching", expectedIntent: "clarification_needed" },
  { name: "missing-part-clarifies", query: "Is this compatible with WDT780SAEM1?", live: "matching", expectedIntent: "clarification_needed" },
  { name: "model-case-normalization", query: "Is ps11752778 compatible with wdt780saem1?", live: "matching", expectedStatus: "compatible", expectedReason: "supported", expectedIntent: "compatibility_check" }
];
