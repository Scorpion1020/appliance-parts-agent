import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(frontend, "../ShoppingAgent");
const envFile = path.join(frontend, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
// 只在子进程环境中传递配置，避免通过shell参数或日志泄露密钥。
const child = spawn(path.join(backend, ".venv/bin/python"), [
  "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"
], { cwd: backend, stdio: "inherit", env: {
  ...process.env, PYTHONDONTWRITEBYTECODE: "1",
  SHOPPING_AGENT_CATALOG_PATH: path.join(backend, "data/parts-catalog.json")
} });
child.on("error", () => { console.error("Python backend could not start; check its virtual environment."); process.exitCode = 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));
