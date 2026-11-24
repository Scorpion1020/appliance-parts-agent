import { shoppingRequest, ShoppingError } from "@/lib/shopping";
import type { Product, ApplianceType } from "@/lib/types";

type CatalogProduct = {
  id: string; name: string; category: string | null; price: string | null;
  currency: string | null; available: boolean; stock_qty: number | null;
  manufacturer_part_number: string; brand: string; source_url: string;
  data_origin: string; symptoms: string[]; description?: string | null;
};

function toProduct(item: CatalogProduct): Product {
  if (!["refrigerator", "dishwasher"].includes(item.category ?? "") || item.currency !== "USD") {
    throw new ShoppingError("catalog_mismatch", "The backend must use the exported USD appliance parts catalog.", 502);
  }
  const price = item.price === null ? null : Number(item.price);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    throw new ShoppingError("catalog_mismatch", "Invalid backend price.", 502);
  }
  return {
    partNumber: item.id, manufacturerPartNumber: item.manufacturer_part_number || item.id,
    name: item.name, description: item.description ?? "Catalog entry; consult the manufacturer for details.",
    applianceType: item.category as ApplianceType, brand: item.brand || "Unknown",
    price, availability: !item.available ? "Out of stock" : item.stock_qty === null ? "Unknown" : item.stock_qty > 0 ? "In stock" : "Out of stock",
    compatibleModels: [], symptoms: item.symptoms, installationSteps: [],
    sourceUrl: item.source_url, sourceType: "product", purchasable: item.available && price !== null && (item.stock_qty === null || item.stock_qty > 0),
    catalogOrigin: item.data_origin
  };
}

export async function getBackendProduct(partNumber: string): Promise<Product> {
  return toProduct(await shoppingRequest<CatalogProduct>(`/products/${encodeURIComponent(partNumber)}`));
}

export async function searchBackendProducts(query: string, applianceType?: ApplianceType | null): Promise<Product[]> {
  const params = new URLSearchParams({ q: query, available_only: "false", limit: "5" });
  // 明确编号优先于旧会话中的设备类型，避免跨设备查件时被错误过滤。
  if (applianceType && !/\b[A-Z]*\d[A-Z0-9-]{4,}\b/i.test(query)) params.set("category", applianceType);
  const result = await shoppingRequest<{ results: CatalogProduct[] }>(`/products/search?${params}`);
  return result.results.map(toProduct);
}
