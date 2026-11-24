import { createSource } from "@/lib/catalog/normalize";
import { getCache, setCache } from "@/lib/cache";
import type { Source, Product, ApplianceType } from "@/lib/types";
import { searchPartSelect } from "@/lib/web/partselectSearch";
import { fetchPartSelectPage } from "@/lib/web/partselectFetch";
import { extractPartData } from "@/lib/web/extractPartData";
import { extractRepairGuide } from "@/lib/web/extractRepairGuide";
import { evaluateCompatibility, evidenceFromProduct } from "@/lib/agent/compatibilityEvidence";
import { extractValidPartNumber } from "@/lib/validation";

type LivePartResult = {
  status: "verified_live" | "demo_fallback";
  product: Product | null;
  sources: Source[];
  reason?: string;
};

type LiveRepairResult = {
  status: "verified_live" | "demo_fallback";
  issue: string;
  diagnosticChecklist: string[];
  possibleCauses: string[];
  recommendedParts: Product[];
  sources: Source[];
  reason?: string;
};

function cacheKey(prefix: string, query: string) {
  return `${prefix}:${query.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function timeoutResult<T>(value: T, timeoutMs = 1200): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), timeoutMs);
  });
}

export function normalizeAvailability(value: string | null): Product["availability"] {
  const normalized = value?.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized === "instock") return "In stock";
  if (normalized === "limitedstock") return "Limited stock";
  if (normalized === "outofstock") return "Out of stock";
  return "Unknown";
}

function buildProductFromPage(data: ReturnType<typeof extractPartData>, sourceType: Source["type"]): Product | null {
  if (!data.partNumber) return null;

  const partNumber = data.partNumber.toUpperCase();
  const manufacturerPartNumber = (data.manufacturerPartNumber ?? partNumber).toUpperCase();
  const typeSource = `${data.modelType ?? ""} ${data.category ?? ""} ${data.description ?? ""} ${data.name}`.toLowerCase();
  const applianceType = /dishwasher/i.test(typeSource) ? "dishwasher" : /refrigerator|fridge/i.test(typeSource) ? "refrigerator" : null;
  if (!applianceType) return null;

  return {
    partNumber,
    manufacturerPartNumber,
    name: data.name,
    description: data.description ?? data.name,
    applianceType,
    brand: data.brand ?? "PartSelect",
    price: data.price,
    availability: normalizeAvailability(data.availability),
    compatibleModels: data.compatibleModels,
    symptoms: data.symptoms,
    installationSteps: data.installationInstructions,
    sourceUrl: data.sourceUrl,
    sourceType
  };
}

function liveSources(title: string, url: string, type: Source["type"]) {
  return [createSource(title, url, type, "live")];
}

function hasUsefulRepairGuide(guide: ReturnType<typeof extractRepairGuide>) {
  return (
    guide.diagnosticSteps.length > 0 &&
    guide.diagnosticSteps.every((step) => step.length <= 260) &&
    !guide.diagnosticSteps.some((step) =>
      /skip to main content|sign in|create account|departments|brands|price match guarantee/i.test(step)
    )
  );
}

async function lookupLivePartUnbounded(query: string): Promise<LivePartResult> {
  const key = cacheKey("live-part", query);
  const cached = getCache<LivePartResult>(key);
  if (cached) return cached;

  try {
    const exactPartNumber = extractValidPartNumber(query) ?? (/^[A-Z][A-Z0-9]{5,}$/i.test(query.trim()) && /\d/.test(query) ? query.trim().toUpperCase() : null);
    const variants = Array.from(
      new Set(
        [query, exactPartNumber, exactPartNumber ? `${exactPartNumber} PartSelect` : null, `${query} PartSelect`]
          .filter((value): value is string => Boolean(value))
      )
    );

    for (const variant of variants) {
      const candidates = await searchPartSelect(variant);
      for (const candidate of candidates.slice(0, 3)) {
        const html = await fetchPartSelectPage(candidate.url);
        const data = extractPartData(html, candidate.url);
        const product = buildProductFromPage(data, "product");
        if (product && exactPartNumber && ![product.partNumber, product.manufacturerPartNumber].includes(exactPartNumber.toUpperCase())) continue;
        if (product) {
          const result: LivePartResult = {
            status: "verified_live",
            product,
            sources: liveSources(data.name || candidate.title, candidate.url, "product")
          };
          setCache(key, result);
          return result;
        }
      }
    }
  } catch (error) {
    const result: LivePartResult = {
      status: "demo_fallback",
      product: null,
      sources: [],
      reason: error instanceof Error ? error.message : "Live lookup failed"
    };
    setCache(key, result);
    return result;
  }

  const result: LivePartResult = {
    status: "demo_fallback",
    product: null,
    sources: [],
    reason: "No verified PartSelect product page found"
  };
  setCache(key, result);
  return result;
}

export async function lookupLivePart(query: string): Promise<LivePartResult> {
  const key = cacheKey("live-part", query);
  const cached = getCache<LivePartResult>(key);
  if (cached) return cached;

  const fallback: LivePartResult = {
    status: "demo_fallback",
    product: null,
    sources: [],
    reason: "Live lookup timed out"
  };
  const result = await Promise.race([lookupLivePartUnbounded(query), timeoutResult(fallback)]);
  if (!result.product) setCache(key, result, 2 * 60 * 1000);
  return result;
}

export async function lookupLiveCompatibility(partNumber: string, modelNumber: string) {
  const live = await lookupLivePart(partNumber);
  if (!live.product || ![live.product.partNumber, live.product.manufacturerPartNumber].some((id) => id.trim().toUpperCase() === partNumber.trim().toUpperCase())) {
    return {
      status: "demo_fallback" as const,
      product: null,
      compatibility: evaluateCompatibility(partNumber, modelNumber, []),
      sources: [],
      reason: live.reason
    };
  }

  const source = live.sources[0];
  const compatibility = evaluateCompatibility(partNumber, modelNumber,
    source ? evidenceFromProduct(live.product, partNumber, modelNumber, source) : []);
  return {
    status: live.status,
    product: live.product,
    compatibility,
    sources: live.sources,
    reason: live.reason
  };
}

export async function lookupLiveInstallation(query: string) {
  const live = await lookupLivePart(query);
  return live;
}

async function lookupLiveTroubleshootingUnbounded(query: string, applianceType?: ApplianceType | null) {
  const key = cacheKey("live-repair", `${applianceType ?? "unknown"}:${query}`);
  const cached = getCache<LiveRepairResult>(key);
  if (cached) return cached;

  try {
    const normalized = query.toLowerCase();
    const variants = [
      query,
      normalized.includes("ice maker") ? "not making ice" : null,
      normalized.includes("no ice") ? "not making ice" : null,
      normalized.includes("leak") ? "leaking" : null,
      normalized.includes("dirty dishes") || normalized.includes("poor cleaning") ? "not cleaning" : null,
      normalized.includes("rack") ? "rack not rolling" : null
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => `${applianceType ?? ""} ${value} repair`.trim());

    for (const variant of Array.from(new Set(variants))) {
      const candidates = await searchPartSelect(variant, applianceType);
      for (const candidate of candidates.slice(0, 3)) {
        if (!/partselect\.com\/(repair|instant-repairman)/i.test(candidate.url)) continue;
        const html = await fetchPartSelectPage(candidate.url);
        const guide = extractRepairGuide(html, candidate.url);
        if (!hasUsefulRepairGuide(guide)) continue;

        const result: LiveRepairResult = {
          status: "verified_live",
          issue: guide.title,
          diagnosticChecklist: guide.diagnosticSteps.slice(0, 5),
          possibleCauses: guide.possibleCauses.length > 0 ? guide.possibleCauses : guide.diagnosticSteps.slice(0, 3),
          recommendedParts: [],
          sources: [createSource(guide.title, guide.sourceUrl, "troubleshooting", "live")]
        };
        setCache(key, result);
        return result;
      }
    }
  } catch (error) {
    const result: LiveRepairResult = {
      status: "demo_fallback",
      issue: "Repair guidance",
      diagnosticChecklist: [],
      possibleCauses: [],
      recommendedParts: [],
      sources: [],
      reason: error instanceof Error ? error.message : "Live repair lookup failed"
    };
    setCache(key, result);
    return result;
  }

  const result: LiveRepairResult = {
    status: "demo_fallback",
    issue: "Repair guidance",
    diagnosticChecklist: [],
    possibleCauses: [],
    recommendedParts: [],
    sources: [],
    reason: "No verified PartSelect repair guide found"
  };
  setCache(key, result);
  return result;
}

export async function lookupLiveTroubleshooting(query: string, applianceType?: ApplianceType | null) {
  const key = cacheKey("live-repair", `${applianceType ?? "unknown"}:${query}`);
  const cached = getCache<LiveRepairResult>(key);
  if (cached) return cached;

  const fallback: LiveRepairResult = {
    status: "demo_fallback",
    issue: "Repair guidance",
    diagnosticChecklist: [],
    possibleCauses: [],
    recommendedParts: [],
    sources: [],
    reason: "Live repair lookup timed out"
  };
  const result = await Promise.race([
    lookupLiveTroubleshootingUnbounded(query, applianceType),
    timeoutResult(fallback)
  ]);
  if (result.status === "demo_fallback") setCache(key, result, 2 * 60 * 1000);
  return result;
}
