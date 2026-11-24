import type { CompatibilityEvidence } from "@/lib/types";

// 人工查证的精确配件/型号关系，非实时抓取；有效期由判定层统一限制。
export const reviewedCompatibility: CompatibilityEvidence[] = [
  {
    partNumber: "PS11752778", modelNumber: "WSF26C3EXF01", verdict: "compatible",
    excerpt: "Supplier Q&A identifies PS11752778 as the lower door bin for WSF26C3EXF01 (paraphrased).",
    source: { title: "Reviewed supplier Q&A: lower door bin", type: "compatibility", origin: "reviewed",
      retrievedAt: "2026-10-01T00:00:00Z",
      url: "https://www.partselect.com/PS11752778-Whirlpool-WPW10321304-Refrigerator-Door-Shelf-Bin.htm" }
  },
  {
    partNumber: "WPW10448645", modelNumber: "ADB1500ADB1", verdict: "compatible",
    excerpt: "ADB1500ADB1 appears in the supplier's compatible-model table for middle spray arm WPW10448645 (paraphrased).",
    source: { title: "Reviewed model table: middle spray arm", type: "compatibility", origin: "reviewed",
      retrievedAt: "2026-10-01T00:00:00Z",
      url: "https://www.partselect.com/PS11754873-Whirlpool-WPW10448645-Middle-Spray-Arm.htm" }
  }
];
