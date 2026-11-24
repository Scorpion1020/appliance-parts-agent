import fs from "node:fs";
import path from "node:path";
import { products } from "@/data/products";

// 从同一份配件种子生成后端目录与演示安装/型号明细，避免前后端数据漂移。
const output = path.resolve(process.argv[2] ?? "../ShoppingAgent/data/parts-catalog.json");
const catalog = products.map((product) => ({
  id: product.partNumber,
  type: "product",
  name: product.name,
  market_id: "US",
  language: "en",
  category: product.applianceType,
  price: product.price,
  currency: "USD",
  description: product.description,
  manufacturer_part_number: product.manufacturerPartNumber,
  brand: product.brand,
  symptoms: product.symptoms,
  available: product.price !== null && ["In stock", "Limited stock"].includes(product.availability),
  stock_qty: null,
  tags: [product.brand, product.partNumber, product.manufacturerPartNumber, ...product.symptoms],
  source_url: product.sourceUrl,
  data_origin: "demo_seed"
}));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(catalog, null, 2) + "\n");
console.log(`Exported ${catalog.length} demo parts to ${output}`);

// 同步更新 ShoppingAgent/data/evidence-data.json 中的 demoPartDetails（保留 reviewedCompatibility 与 troubleshootingGuides）
const evidencePath = path.resolve(path.dirname(output), "evidence-data.json");
if (fs.existsSync(evidencePath)) {
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf-8"));
  const demoPartDetails: Record<string, { compatibleModels: string[]; installationSteps: string[] }> = {};
  for (const product of products) {
    demoPartDetails[product.partNumber] = {
      compatibleModels: product.compatibleModels ?? [],
      installationSteps: product.installationSteps ?? []
    };
  }
  evidence.demoPartDetails = demoPartDetails;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Synced ${Object.keys(demoPartDetails).length} demoPartDetails to ${evidencePath}`);
}
