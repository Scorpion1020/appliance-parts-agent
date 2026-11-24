import { catalog } from "@/data/generated/catalog";
import type { CompatibilityResult, Product } from "@/lib/types";
import { evaluateCompatibility, evidenceFromProduct } from "@/lib/agent/compatibilityEvidence";

export type CompatibilityInput = {
  partNumber: string;
  modelNumber: string;
};

export type CompatibilityOutput = {
  product: Product | null;
  compatibility: CompatibilityResult;
};

export function checkCompatibility({ partNumber, modelNumber }: CompatibilityInput): CompatibilityOutput {
  const normalizedPartNumber = partNumber.trim().toUpperCase();
  const product =
    catalog.products.find((item) => item.partNumber === normalizedPartNumber) ??
    catalog.products.find((item) => item.manufacturerPartNumber === normalizedPartNumber) ??
    null;

  if (!product) {
    return {
      product: null,
      compatibility: evaluateCompatibility(partNumber, modelNumber, [])
    };
  }

  return {
    product,
    compatibility: evaluateCompatibility(partNumber, modelNumber, evidenceFromProduct(product, partNumber, modelNumber, {
      title: `${product.partNumber} demo catalog model list`, url: product.sourceUrl, type: "compatibility", origin: "demo"
    }))
  };
}
