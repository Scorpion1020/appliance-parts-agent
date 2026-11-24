import type { AgentResponse, ConversationMemory } from "@/lib/types";
import type { FunctionDefinition } from "@/lib/agent/model-provider";
import { checkCompatibility } from "@/lib/agent/tools/compatibility";
import { getInstallationGuide } from "@/lib/agent/tools/installation";
import { getTroubleshootingFlow } from "@/lib/agent/tools/troubleshooting";
import { lookupLiveCompatibility } from "@/lib/web/grounding";
import { buildCompatibilityMessage, buildLookupMessage, PART_NOT_FOUND_MESSAGE } from "@/lib/agent/prompts";
import { createSource } from "@/lib/catalog/normalize";
import { isValidPartNumber } from "@/lib/validation";
import { searchKnowledge } from "@/lib/agent/tools/knowledge";
import { detectApplianceType } from "@/lib/agent/router";
import { searchBackendProducts, getBackendProduct } from "@/lib/catalog/backend";
import { reviewedCompatibility } from "@/data/reviewedCompatibility";
import { evaluateCompatibility } from "@/lib/agent/compatibilityEvidence";

export const toolFields = {
  getProductDetails: ["partNumber"],
  prepareCartAddition: ["partNumber", "quantity"],
  searchKnowledge: ["query"],
  searchProducts: ["query"],
  checkCompatibility: ["partNumber", "modelNumber"],
  getInstallationGuide: ["partNumber"],
  getTroubleshootingFlow: ["query"]
} as const;
export type ReadTool = keyof typeof toolFields;
export type ReadToolRunner = (name: ReadTool, args: Record<string, string>, memory: ConversationMemory) => Promise<AgentResponse>;

function definition(name: string, description: string, properties: Record<string, unknown>): FunctionDefinition {
  return { type: "function", function: { name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } } };
}
const textField = { type: "string" };
export const modelTools: FunctionDefinition[] = [
  definition("getProductDetails", "Read authoritative catalog details and demo price for an exact part number. Does not prove compatibility.", { partNumber: textField }),
  definition("prepareCartAddition", "READ ONLY: prepare an addition for user confirmation, never change the cart. Only when user asks to add. Quantity is an integer string 1-20. If adding is conditional on compatibility, check it first and only prepare when compatible. Ask for the exact part when ambiguous.", { partNumber: textField, quantity: textField }),
  definition("searchKnowledge", "Search reviewed manufacturer maintenance summaries with document versions and citations. General guidance only: never use it as parts compatibility proof. No hit means insufficient evidence, not a negative fact.", { query: textField }),
  definition("searchProducts", "Read-only product search. Use an exact part number or a refrigerator/dishwasher part description. Demo data is not verified live.", { query: textField }),
  definition("checkCompatibility", "Read-only evidence check for an exact part and complete appliance model. Missing/contradictory evidence means unknown, not incompatible.", { partNumber: textField, modelNumber: textField }),
  definition("getInstallationGuide", "Read-only installation steps from the DEMONSTRATION catalog, not verified instructions. Requires an exact part.", { partNumber: textField }),
  definition("getTroubleshootingFlow", "Read-only DEMONSTRATION diagnostic checklist for refrigerator/dishwasher symptoms.", { query: textField }),
  definition("finish", "Finish using only successful tool result IDs, in desired order. Or ask for missing information / report out of scope. Never invent facts. Every compatibility check result must be included.", {
    resultIds: { type: "array", items: { type: "string" } },
    missing: { type: "string", enum: ["none", "part", "model", "symptom", "out_of_scope"] }
  })
];

export function validateReadArguments(name: string, value: unknown): Record<string, string> {
  if (!Object.prototype.hasOwnProperty.call(toolFields, name)) throw new Error("Unknown or forbidden tool. Only listed read-only tools are permitted.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Arguments must be an object.");
  const args = value as Record<string, unknown>;
  const fields = toolFields[name as ReadTool];
  if (Object.keys(args).length !== fields.length || fields.some((field) => typeof args[field] !== "string" || !(args[field] as string).trim())) {
    throw new Error("Supply exactly the required nonempty string fields.");
  }
  const normalized: Record<string, string> = {};
  for (const field of fields) {
    const text = (args[field] as string).trim();
    if (text.length > (field === "query" ? 1000 : 64)) throw new Error("Tool argument exceeds its length limit.");
    if (field === "quantity" && (!/^\d{1,2}$/.test(text) || Number(text) < 1 || Number(text) > 20)) throw new Error("Quantity must be an integer from 1 to 20.");
    if (field !== "query" && field !== "quantity" && (!/^[A-Z0-9-]+$/i.test(text) || !/[0-9]/.test(text))) throw new Error("Use a complete alphanumeric part or model number.");
    if (field === "partNumber" && /^PS/i.test(text) && !isValidPartNumber(text)) throw new Error("PartSelect part number is incomplete or invalid.");
    normalized[field] = field === "query" ? text : text.toUpperCase();
  }
  return normalized;
}

export const runReadTool: ReadToolRunner = async (name, args, memory) => {
  if (name === "getProductDetails") {
    const product = await getBackendProduct(args.partNumber);
    return { intent: "part_lookup", tool: "getProductDetails", message: buildLookupMessage(product), products: [product], groundingStatus: "unverified" };
  }
  if (name === "prepareCartAddition") {
    const product = await getBackendProduct(args.partNumber);
    if (!product.purchasable || product.price === null) throw new Error("This catalog product is not available for addition.");
    return { intent: "cart_action", tool: "prepareCartAddition", groundingStatus: "unverified",
      message: `Review before confirming: add ${Number(args.quantity)} × ${product.name} (${product.partNumber}). Catalog unit price: USD ${product.price.toFixed(2)}. No cart change has been made; this is not a compatibility guarantee.`,
      products: [product], cartProposal: { partNumber: product.partNumber, quantity: Number(args.quantity), name: product.name, unitPrice: product.price }
    };
  }
  if (name === "searchKnowledge") return searchKnowledge(args.query, detectApplianceType(args.query) ?? memory.applianceType);
  if (name === "searchProducts") {
    const products = await searchBackendProducts(args.query, detectApplianceType(args.query) ?? memory.applianceType);
    return {
      intent: "part_lookup", tool: name, message: products[0] ? buildLookupMessage(products[0]) : PART_NOT_FOUND_MESSAGE,
      products, groundingStatus: "unverified",
      sources: products.filter(product => product.sourceUrl).map((product) => createSource(product.name, product.sourceUrl, "product"))
    };
  }
  if (name === "checkCompatibility") {
    const live = await lookupLiveCompatibility(args.partNumber, args.modelNumber);
    const result = evaluateCompatibility(args.partNumber, args.modelNumber, [
      ...live.compatibility.evidence, ...reviewedCompatibility,
      ...checkCompatibility({ partNumber: args.partNumber, modelNumber: args.modelNumber }).compatibility.evidence
    ]);
    return { intent: "compatibility_check", tool: name, message: buildCompatibilityMessage(result),
      compatibility: result, groundingStatus: result.evidence.some(item => item.source.origin === "reviewed") ? "unverified" : live.status,
      sources: result.evidence.map((item) => item.source) };
  }
  if (name === "getInstallationGuide") {
    const result = getInstallationGuide({ partNumber: args.partNumber });
    return { intent: "installation_guide", tool: name, message: result.product
      ? result.steps.length ? `以下是 ${args.partNumber} 的演示安装步骤，未经针对该型号的核验。操作前请核对厂家说明并断电断水；不确定时请联系专业人员。`
        : `暂无 ${args.partNumber} 的可靠安装步骤。请查看厂家说明或商品来源，不要据此自行拆装。`
      : PART_NOT_FOUND_MESSAGE,
      steps: result.steps, groundingStatus: "demo_fallback",
      sources: result.product ? [createSource(result.product.name, result.product.sourceUrl, "installation")] : [] };
  }
  const result = getTroubleshootingFlow({ query: args.query, applianceType: memory.applianceType });
  return { intent: "troubleshooting", tool: name,
    message: "This is a demonstration diagnostic checklist, not a verified diagnosis. Disconnect power/water before physical inspection and consult a qualified technician when unsure.",
    sections: [{ title: result.issue, items: result.diagnosticChecklist }, { title: "Possible causes (unverified)", items: result.possibleCauses }],
    products: result.recommendedParts, groundingStatus: "demo_fallback",
    sources: [createSource(result.issue, result.sourceUrl, "troubleshooting")] };
};
