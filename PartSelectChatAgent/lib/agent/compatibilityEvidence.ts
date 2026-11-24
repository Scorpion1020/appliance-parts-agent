import type { CompatibilityEvidence, CompatibilityResult, Product, Source } from "@/lib/types";
import { isPartSelectUrl } from "@/lib/web/sourceUrl";

function normalize(value: string) { return value.trim().toUpperCase(); }

export function evaluateCompatibility(partNumber: string, modelNumber: string, records: CompatibilityEvidence[]): CompatibilityResult {
  const part = normalize(partNumber);
  const model = normalize(modelNumber);
  const evidence = records.filter((record) => normalize(record.partNumber) === part
    && normalize(record.modelNumber) === model && record.excerpt.trim().length > 0
    && isPartSelectUrl(record.source.url));
  const live = evidence.filter((record) => {
    if (record.source.origin === "live") return true;
    const age = Date.now() - Date.parse(record.source.retrievedAt ?? "");
    return record.source.origin === "reviewed" && age >= 0 && age <= 90 * 24 * 60 * 60 * 1000;
  });
  const supports = live.some((record) => record.verdict === "compatible");
  const excludes = live.some((record) => record.verdict === "incompatible");
  const status = supports === excludes ? "unknown" : supports ? "compatible" : "incompatible";
  const reason = supports && excludes ? "conflicting_evidence" : supports ? "supported"
    : excludes ? "explicit_exclusion" : evidence.some(record => record.source.origin === "demo") ? "demo_only" : "no_evidence";
  return {
    partNumber: part, modelNumber: model, status, reason, evidence,
    nextAction: status === "unknown"
      ? "Confirm the full model label and verify fit with the manufacturer or supplier before buying."
      : status === "incompatible" ? "Do not use this part for the specified model; find an explicitly supported replacement."
        : "Confirm the complete model suffix and the supplier's current fit information before buying."
  };
}

export function evidenceFromProduct(product: Product, partNumber: string, modelNumber: string, source: Source): CompatibilityEvidence[] {
  const part = normalize(partNumber);
  const model = normalize(modelNumber);
  if (![product.partNumber, product.manufacturerPartNumber].some((value) => normalize(value) === part)) return [];
  const listedModel = product.compatibleModels.find((value) => normalize(value) === model);
  // 列表不完整：只有明确出现才形成正向证据，缺席不能形成反向证据。
  return listedModel ? [{ partNumber: part, modelNumber: model, verdict: "compatible", excerpt: listedModel, source }] : [];
}
