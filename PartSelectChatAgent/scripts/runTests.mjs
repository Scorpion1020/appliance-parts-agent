import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";

// 离线检查不继承演示服务的模型密钥和执行模式，避免误触真实接口。
const testEnvironment = { ...process.env };
for (const key of Object.keys(testEnvironment)) {
  if (/^(OPENAI_|DASHSCOPE_|MODEL_PROVIDER$|AGENT_EXECUTION_MODE$)/.test(key)) delete testEnvironment[key];
}
const files = readdirSync("tests").filter(name => name.endsWith(".test.ts")).sort().map(name => `tests/${name}`);
if (!files.length) throw new Error("No test files found.");
const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tests/tsconfig.json", "--test", ...files],
  { env: testEnvironment, stdio: "inherit" });
child.on("error", () => { console.error("Could not start offline checks."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
