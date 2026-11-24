import type { CompatibilityResult, Product } from "@/lib/types";
import { chineseText } from "@/lib/zh";

export const OUT_OF_SCOPE_MESSAGE =
  "I can only help with refrigerator and dishwasher parts, installation, compatibility, troubleshooting, and order support.";

export const CLARIFICATION_MESSAGE =
  "I can help if you share a part number, model number, appliance type, or the symptom you're seeing.";

export const EMPTY_INPUT_MESSAGE =
  "Please enter a part number, model number, or describe the appliance issue you'd like help with.";

export const PART_NOT_FOUND_MESSAGE =
  "I couldn't find that part in the catalog. Please check the part number or share a product description.";

export const UNKNOWN_PRODUCT_MESSAGE =
  "I couldn't find a matching part in the catalog. Try a part number, model number, or appliance description.";

export const INCOMPLETE_PART_NUMBER_MESSAGE =
  "That part number looks incomplete. PartSelect part numbers usually look like PS11752778. Could you provide the full part number?";

export const INSTALLATION_PART_NEEDED_MESSAGE =
  "Which part would you like installation help with? Please provide a PartSelect part number like PS11752778.";

export function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(price);
}

export function formatProductSummary(product: Product) {
  return `${product.name} (${product.partNumber})`;
}

export function buildLookupMessage(product: Product) {
  return `找到了${chineseText(product.name)}。${chineseText(product.description)}`;
}

export function buildCompatibilityMessage(result: CompatibilityResult) {
  const pair = `${result.partNumber} and model ${result.modelNumber}`;
  const conclusion = result.status === "compatible"
    ? `The cited source supports compatibility between ${pair}.${result.evidence.some(item => item.source.origin === "reviewed") ? " This includes a dated reviewed record, not a live fit guarantee." : ""}`
    : result.status === "incompatible"
      ? `An explicit source states that ${pair} are not compatible.`
      : result.reason === "conflicting_evidence"
        ? `The sources conflict about ${pair}; compatibility is unknown.`
        : result.reason === "demo_only"
          ? `Only demonstration data links ${pair}; real compatibility is unknown.`
          : `I could not verify compatibility between ${pair}. Absence from a retrieved list does not prove incompatibility.`;
  return `${conclusion} ${result.nextAction}`;
}

export function buildInstallationMessage(product: Product) {
  return product.installationSteps.length
    ? `以下为${chineseText(product.name)}的安装参考，实际操作前请核对厂家说明。`
    : `暂无 ${product.partNumber} 的可靠安装步骤。请核对厂家说明，不要据此自行拆装。`;
}

export function buildTroubleshootingMessage(issue: string) {
  return `以下为“${chineseText(issue)}”的演示排查流程，不是已核实的故障诊断。实际操作前请核对厂家说明。`;
}
