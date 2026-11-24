# 当前交付说明：家电配件咨询与确认式购物 Agent

更新日期：2026-11-23。本文为当前版本的唯一功能与运行入口说明。

## 架构与技术栈

* **前端**：Next.js 15 + React 19 + TypeScript + Tailwind CSS，负责中文交互界面、SSE 实时进度条、结构化卡片、确认写入入口、用户反馈采集与侧边栏运行指标面板。
* **后端**：FastAPI + Python LangGraph（纯 Python 镜像，无 Node.js 运行时依赖），负责原生多工具决策循环、纯 Python 只读证据工具、中英双语知识检索、受控中文摘要生成及 SQLite 持久化。
* **独立 MCP 服务**：`ShoppingAgent/app/agent/mcp_server.py` 提供只读 MCP stdio 接口（商品检索、商品详情、知识检索），主聊天链路直接通过 FastAPI 内部接口调用。

## 已实现的核心能力与边界

* **模型调用**：阿里云百炼 OpenAI 兼容接口，默认原生多工具模式（`tool_choice="required"`），全局 `httpx.AsyncClient` 连接池复用 + 429/5xx 瞬态指数退避重试 + 免费额度耗尽备用模型切换；单轮 6 步 / 55 秒预算。
* **流式体验与受控摘要**：`POST /api/chat/stream` → `POST /agent/stream` 实时推送决策与工具执行进度；工具结果汇总后由 `synthesize_grounded_summary` 生成基于事实的中文摘要，不覆写价格、库存与适配状态。
* **目录与知识库**：
  * **20 个结构化演示配件 SKU**（涵盖 Whirlpool、GE 冰箱与洗碗机高频配件），通过 `npm run export:shopping` 自动同步至后端 `parts-catalog.json` 与 `evidence-data.json`。
  * **15 份审核厂家维护文档 / 30 个结构化片段**，默认 BM25（内置动态品牌提取、中英双语查询改写、越界家电与未收录品牌拒答），可选 BGE-small 384 维本地向量 + NumPy + RRF 混合检索。
* **适配与确认式购物**：审核快照严格区分于演示目录与一般维护知识，有效期 90 天；所有加购仅生成待确认建议并绑定设备/型号上下文，确认时复查价格与证据，通过 SQLite 事务 + 幂等键防重复写入。
* **反馈与指标闭环**：前端每条回复支持“有帮助 / 需改进 + 原因标签”，落盘至 SQLite `turn_feedback` 表并在刷新后自动回显；侧边栏“会话运行指标”面板实时展示完成轮次、平均耗时、加购转化、累计 Token 与反馈统计。

## 启动方式

### Docker Compose（推荐）

在工作区根目录执行（需先在 `PartSelectChatAgent/.env.local` 配置模型密钥）：

```bash
AGENT_HTTP_PORT=3000 docker compose up -d --build --wait
```

访问 `http://127.0.0.1:3000`。

### 本地原生启动

```bash
# 1. 启动 Python 后端
cd ShoppingAgent
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. 启动 Next.js 前端
cd PartSelectChatAgent
npm ci
npm run seed:data && npm run export:shopping && npm run knowledge:build
npm run dev
```

## 验证命令

```bash
# 后端全量测试（68 项）
cd ShoppingAgent && python -m pytest -q

# 40 条中英双语检索基准评测
cd ShoppingAgent && python -m app.agent.eval_benchmark --output ../PartSelectChatAgent/evals/reports/retrieval-benchmark-v2.json

# 前端全量测试（62 项）与生产构建
cd PartSelectChatAgent && npm test && npm run build
```
