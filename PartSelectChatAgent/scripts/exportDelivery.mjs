import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = await mkdtemp(path.join(os.tmpdir(), "appliance-delivery-"));
const files = [];
const excluded = new Set(["node_modules", ".git", ".next", ".venv", "__pycache__", ".pytest_cache", "embedding-cache", "reports"]);
async function copyEntry(relative) {
  const source = path.join(workspace, relative);
  const name = path.basename(source);
  if (excluded.has(name) || (name.startsWith(".env") && name !== ".env.local.example") || /\.(sqlite3(?:-.*)?|pyc|npz|tsbuildinfo)$/.test(name)) return;
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${relative}`);
  if (stat.isDirectory()) {
    for (const child of await readdir(source)) await copyEntry(path.join(relative, child));
    return;
  }
  const bytes = await readFile(source);
  if (/\bsk-[a-zA-Z0-9_-]{24,}\b/.test(bytes.toString("utf8"))) throw new Error(`Possible credential in ${relative}; export stopped.`);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { errorOnExist: true, force: false });
  files.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex") });
}

const frontend = ["app", "components", "data", "lib", "public", "scripts", "tests", "knowledge", "evals", "docs", ".github",
  "package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts", "next.config.mjs", "middleware.ts", "postcss.config.js", "tailwind.config.js", "Dockerfile", ".dockerignore", ".gitignore", ".env.local.example", "README.md"];
const backend = ["app", "tests", "manual_ui", ".github", "data/catalog.json", "data/parts-catalog.json", "data/evidence-data.json", "pyproject.toml", "requirements.lock", "requirements-dev.lock", "Dockerfile", ".dockerignore", ".gitignore", "README.md"];
for (const [project, entries] of [["PartSelectChatAgent", frontend], ["ShoppingAgent", backend]]) {
  for (const entry of entries) {
    const relative = path.join(project, entry);
    try { await lstat(path.join(workspace, relative)); }
    catch (error) { if (error.code === "ENOENT" && ["public", "next-env.d.ts"].includes(entry)) continue; throw error; }
    await copyEntry(relative);
  }
}
for (const entry of ["compose.yaml", ".dockerignore"]) await copyEntry(entry);
await writeFile(path.join(destination, "DELIVERY.json"), JSON.stringify({
  createdAt: new Date().toISOString(), scope: "Sanitized working-tree snapshot, not a clean Git checkout. No credentials, dependencies or user database.", files
}, null, 2));
console.log(JSON.stringify({ destination, files: files.length }));
