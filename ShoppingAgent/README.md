# ShoppingAgent 后端服务（FastAPI + LangGraph）

家电配件咨询与确认式购物 Agent 的纯 Python 后端服务，负责 **LangGraph 智能体决策编排、纯 Python 证据核验、中英双语知识检索、商品目录查询、幂等购物车与会话/反馈持久化**，并提供独立的只读 MCP 服务接口。

---

## 核心模块

* **`app/agent/graph.py`**：LangGraph 有界循环（`decide` ↔ `execute`），支持 6 步 / 55 秒执行预算、重复工具调用指纹拦截、事件回调流式推送及受控中文总结节点。
* **`app/agent/provider.py`**：OpenAI 兼容协议模型客户端，默认使用原生多工具调用（`tool_choice="required"`，支持 `AGENT_TOOL_DISPATCH_MODE=wrapped` 对照）、全局 `httpx.AsyncClient` 连接池复用、429/5xx 瞬态指数退避重试及免费额度耗尽备用模型切换。
* **`app/agent/evidence.py`**：纯 Python 实现的只读证据工具（精确适配核验与 90 天审核快照有效期、安装指引、故障排障流程），零跨进程依赖。
* **`app/agent/knowledge.py` & `vector_search.py`**：支持动态品牌识别、中英双语领域同义词改写、越界家电/未收录品牌拦截的 BM25 检索，以及可选 BGE-small + NumPy + RRF 混合检索。
* **`app/agent/mcp_server.py`**：基于 FastMCP 的独立只读 MCP 服务，对外暴露商品搜索、详情与知识检索工具，不开放写入能力。
* **`app/cart/` & `app/conversation/`**：基于 SQLite 事务的幂等购物车写入、会话执行租约、多轮历史快照、用户点赞/点踩反馈存储与指标聚合（`GET /carts/{cart_id}/conversation/metrics`）。

---

## 主要接口

| 模块 | 接口 | 说明 |
| :--- | :--- | :--- |
| 健康检查 | `GET /health` | 服务存活检查 |
| 智能体执行 | `POST /agent/run`、`POST /agent/stream` | 同步执行 / SSE 流式推送进度与结果 |
| 商品目录 | `GET /products/search`、`GET /products/{id}`、`GET /products/{id}/recommendations` | 20 SKU 家电配件检索、详情与推荐 |
| 购物车 | `POST /carts`、`GET /carts/{id}`、`POST/PATCH/DELETE /carts/{id}/items` | 事务与幂等键保护的演示购物车读写 |
| 会话与反馈 | `GET /carts/{id}/conversation`、`POST .../turns`、`POST .../feedback`、`GET .../metrics` | 多轮状态、租约管理、用户反馈与运行指标聚合 |

---

## 本地运行与测试

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate  |  Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"

# 启动后端服务（默认端口 8000，接口文档见 http://127.0.0.1:8000/docs）
uvicorn app.main:app --host 127.0.0.1 --port 8000

# 运行全量单元测试（68 项）
python -m pytest -q

# 运行 40 条中英双语检索基准评测
python -m app.agent.eval_benchmark
```

### 独立 MCP 服务验证

```bash
# 需先安装 mcp 可选依赖：pip install -e ".[mcp]"
python -m app.agent.mcp_server
python -m app.agent.check_mcp
```
