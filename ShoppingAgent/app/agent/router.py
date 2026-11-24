import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.agent.graph import execute_graph
from app.agent.models import AgentRequest
from app.shared.errors import AgentToolError

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/run")
async def run_agent(request: AgentRequest) -> dict:
    # 内部只读接口，后端应仅监听本机或受控容器网络。
    return await execute_graph(request)


def _format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/stream")
async def stream_agent(request: AgentRequest) -> StreamingResponse:
    """SSE 流式执行接口：实时推送 LangGraph 决策与工具执行进度，最终返回完整结果或受控错误。"""
    queue: asyncio.Queue[tuple[str, dict] | None] = asyncio.Queue()

    async def on_event(event: dict) -> None:
        await queue.put(("progress", event))

    async def worker() -> None:
        try:
            payload = await execute_graph(request, on_event=on_event)
            await queue.put(("result", payload))
        except AgentToolError as exc:
            await queue.put(
                (
                    "error",
                    {
                        "code": exc.code,
                        "message": exc.message,
                        "statusCode": exc.status_code,
                        "details": exc.details,
                    },
                )
            )
        except Exception:
            await queue.put(
                (
                    "error",
                    {
                        "code": "agent_failed",
                        "message": "Python Agent execution failed.",
                        "statusCode": 502,
                        "details": {},
                    },
                )
            )
        finally:
            await queue.put(None)

    async def event_generator() -> AsyncIterator[str]:
        task = asyncio.create_task(worker())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                event_name, data = item
                yield _format_sse(event_name, data)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
