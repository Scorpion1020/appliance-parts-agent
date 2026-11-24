import { readFile, writeFile, mkdir, rename, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledgeIndex, validateManifest } from "@/lib/knowledge/build";

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const knowledgeRoot = await realpath(path.join(root, "knowledge"));
  const manifest = validateManifest(JSON.parse(await readFile(path.join(knowledgeRoot, "manifest.json"), "utf8")));
  const contents: Record<string, string> = {};
  for (const doc of manifest) {
    const sourcePath = await realpath(path.join(knowledgeRoot, doc.file));
    if (!sourcePath.startsWith(knowledgeRoot + path.sep)) throw new Error("Knowledge source escapes its root.");
    contents[doc.file] = await readFile(sourcePath, "utf8");
  }
  const index = buildKnowledgeIndex(manifest, contents);
  const serialized = JSON.stringify(index, null, 2) + "\n";
  const destination = path.join(root, "data/generated/knowledge-index.json");
  if (process.argv.includes("--check")) {
    if (await readFile(destination, "utf8") !== serialized) throw new Error("Knowledge index is stale. Run npm run knowledge:build.");
  } else {
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + "." + process.pid + ".tmp";
    await writeFile(temporary, serialized, { flag: "wx" });
    await rename(temporary, destination);
  }
  console.log(JSON.stringify({ checked: process.argv.includes("--check"), documents: index.documents.length, chunks: index.chunks.length, indexVersion: index.indexVersion }));
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
