# 家电配件咨询与确认式购物 Agent

面向冰箱与洗碗机维修配件场景的垂直领域 AI Agent 应用。系统采用 **Next.js 15 + React 19（前端交互与会话代理）** 与 **FastAPI + Python LangGraph（纯 Python 智能体编排、检索与持久化）** 前后端分离架构，核心解决大模型在垂类导购中的**幻觉推荐、适配误判、越权写入与长耗时体验**问题。

---

## 核心特性

1. **有界 LangGraph 决策与原生多工具调用**
   * 单轮严格限制 **6 步调用 / 55 秒预算**，通过指纹拦截重复工具调用，单次协议修正兜底，拒绝无限循环。
   * 采用原生多工具调用（`tool_choice="required"`、`parallel_tool_calls=False`），配合全局 `httpx.AsyncClient` 连接池与 429/5xx 瞬态指数退避重试。
2. **全链路 SSE 流式进度 + 受控中文摘要**
   * 通过 `POST /api/chat/stream` → `POST /agent/stream` 实时推送决策与工具执行进度（检索目录 → 核验适配 → 生成摘要）。
   * 事实卡片（价格、型号、库存、适配结论）由确定性工具数据直接渲染；`groundedSummary` 总结节点仅基于已核验 JSON 生成简洁中文导购摘要，禁止编造数据。
3. **证据与知识严格分层（Bilingual RAG + 90 天适配快照）**
   * **20 个结构化冰箱/洗碗机演示 SKU**，支持配件号、厂家编号、症状与品类检索。
   * **15 份审核厂家维护文档 / 30 个结构化片段**，支持 BM25 与可选本地向量（BGE-small + RRF）检索；内置中英双语查询改写、动态品牌识别与越界家电/未收录品牌拒答。
   * 普通维护知识**不可替代**精确型号适配证明；人工审核适配快照具备 **90 天有效期**，过期或证据冲突时返回“未知”，拒绝盲目推荐。
4. **确认式购物闭环（Human-in-the-Loop）**
   * 大模型只拥有只读与“生成加购建议”权限，无法直接写购物车。
   * 加购建议绑定生成时的设备与型号上下文；用户点击确认后，服务端复核价格、可购状态与当前证据，通过 **SQLite 事务 + 幂等键**执行写入；型号变更或证据失效时返回 `409` 拦截旧按钮。
5. **可观测性、用户反馈与独立 MCP 服务**
   * 前端每条回复支持“有帮助 / 需改进 + 原因标签”反馈并持久化至 SQLite，刷新页面自动回显；侧边栏内置“会话运行指标”折叠面板（完成轮次、平均耗时、加购转化漏斗、Token 消耗与反馈统计）。
   * 后端同时提供独立只读 **MCP（Model Context Protocol）** 接口（`app.agent.mcp_server`），供外部 AI 客户端按标准协议调用查询工具。

---

## 系统架构

```text
浏览器（Next.js 15 / React 19 / SSE 实时进度 / 确认式卡片 / 反馈与指标面板）
    │  POST /api/chat/stream | /api/conversation | /api/feedback | /api/metrics
    ▼
Next.js 服务端代理（会话 Cookie、请求校验、确认写入复核、中文展示适配）
    │  POST /agent/stream | /carts/* | /products/*
    ▼
FastAPI + Python LangGraph（纯 Python 后端，无 Node 依赖）
    ├─ decide ──▶ 原生多工具调用（阿里云百炼兼容协议 + 连接池 + 瞬态重试）
    ├─ execute ─▶ 7 类只读/建议工具（目录检索 / 详情 / 适配核验 / 安装 / 排障 / 双语知识库 / 待确认加购）
    ├─ summary ─▶ 受控中文总结（仅消费已核验工具 JSON）
    └─ SQLite ──▶ 会话状态、跨轮候选记忆、幂等购物车、用户反馈与指标聚合
```

详细架构与设计取舍见 [系统架构说明](docs/architecture.md)，交付与验证详情见 [当前交付说明](docs/current-delivery.md) 与 [验证报告](docs/closeout-report.md)。

---

## 快速启动

### 方式一：Docker Compose（推荐）

在工作区根目录（包含 `compose.yaml`、`PartSelectChatAgent/`、`ShoppingAgent/`）先依据 `PartSelectChatAgent/.env.local.example` 配置 `PartSelectChatAgent/.env.local` 中的模型凭据，然后运行：

```bash
AGENT_HTTP_PORT=3000 docker compose up -d --build --wait
```

启动后访问 `http://127.0.0.1:3000`（后端 FastAPI 仅在容器内网通信，不直接对外暴露端口）。

### 方式二：本地原生启动

1. **后端（Python 3.11+）**
   ```bash
   cd ShoppingAgent
   python -m venv .venv
   # Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
   pip install -e ".[dev]"
   uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
2. **前端（Node.js 22+）**
   ```bash
   cd PartSelectChatAgent
   npm ci
   npm run seed:data
   npm run export:shopping
   npm run knowledge:build
   npm run dev
   ```

---

## 测试与评测

```bash
# 前端单元测试（62 项）与生产构建
cd PartSelectChatAgent
npm test
npm run build

# 后端单元测试（68 项，含纯 Python 证据工具、原生调用重试、SSE、Prompt Injection 对抗、反馈与指标）
cd ShoppingAgent
python -m pytest -q

# 40 条中英双语检索基准评测（Recall@1 / Recall@3 / MRR / 负样本拒答率）
python -m app.agent.eval_benchmark --output ../PartSelectChatAgent/evals/reports/retrieval-benchmark-v2.json
```

---

## 边界声明

* 当前商品目录（20 SKU）、价格与演示购物车用于本地功能与工程能力验证，未接入真实电商支付、下单或实时商户库存系统。
* 知识库（15 份厂家审核摘要 / 30 片段）仅提供通用维护指引，不构成型号适配证明或专业维修诊断。
