import asyncio
import json
import logging
import os
import re
from typing import Any

import httpx

from app.shared.errors import AgentToolError

logger = logging.getLogger(__name__)

TRANSIENT_HTTP_STATUSES = {429, 502, 503, 504}
MAX_TRANSIENT_RETRIES = 2
RETRY_BASE_DELAY_SECONDS = 0.4

_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """复用全局异步 HTTP 连接池，避免每次模型调用重复 TCP/TLS 握手。"""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=5.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            trust_env=False,
        )
    return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


class ProtocolError(AgentToolError):
    def __init__(self, tokens: dict[str, int]):
        super().__init__("model_protocol_error", "Return exactly one valid tool call, not plain text.", 502)
        self.tokens = tokens


def parse_reply(
    payload: Any,
    *,
    named_tool: bool = False,
    allowed_tools: set[str] | None = None,
) -> dict:
    if not isinstance(payload, dict):
        raise ProtocolError({"input": 0, "output": 0, "total": 0})
    usage = payload.get("usage") or {}

    def count(key: str) -> int:
        value = usage.get(key, 0) if isinstance(usage, dict) else 0
        return value if type(value) is int and value >= 0 else 0

    tokens = {"input": count("prompt_tokens"), "output": count("completion_tokens"), "total": count("total_tokens")}
    choices = payload.get("choices")
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") or {}
    calls = message.get("tool_calls") if isinstance(message, dict) else None
    # 百炼/兼容协议在 required 或指定函数模式下，可能以 stop 结束但仍返回完整 tool_calls。
    allow_stop_with_calls = named_tool or allowed_tools is not None
    valid_finish = choice.get("finish_reason") == "tool_calls" or (
        allow_stop_with_calls
        and choice.get("finish_reason") == "stop"
        and isinstance(message, dict)
        and not message.get("content")
    )
    if not valid_finish or not isinstance(calls, list) or len(calls) != 1:
        raise ProtocolError(tokens)
    call = calls[0]
    if not isinstance(call, dict) or call.get("type") != "function":
        raise ProtocolError(tokens)
    function = call.get("function")
    if not isinstance(function, dict) or not isinstance(call.get("id"), str) or not 1 <= len(call["id"]) <= 128:
        raise ProtocolError(tokens)
    if not isinstance(function.get("name"), str) or not 1 <= len(function["name"]) <= 128:
        raise ProtocolError(tokens)
    if allowed_tools is not None and function["name"] not in allowed_tools:
        raise ProtocolError(tokens)
    if not isinstance(function.get("arguments"), str) or len(function["arguments"]) > 10000:
        raise ProtocolError(tokens)
    return {"call": call, "tokens": tokens}


def _resolve_models() -> tuple[str, list[str]]:
    key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise AgentToolError("model_not_configured", "Configure DASHSCOPE_API_KEY on the Python service.", 503)
    names = [os.getenv("DASHSCOPE_MODEL", "qwen-plus").strip(), *os.getenv("DASHSCOPE_FALLBACK_MODELS", "").split(",")]
    models = list(dict.fromkeys(name.strip() for name in names if name.strip()))
    if not models or len(models) > 4 or any(not re.fullmatch(r"[A-Za-z0-9._-]+", name) for name in models):
        raise AgentToolError("model_not_configured", "Configure one primary and at most three backup models.", 503)
    return key, models


async def _post_with_retry(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
) -> httpx.Response:
    last_error: Exception | None = None
    for attempt in range(MAX_TRANSIENT_RETRIES + 1):
        try:
            response = await client.post(url, headers=headers, json=body)
            if response.status_code in TRANSIENT_HTTP_STATUSES and attempt < MAX_TRANSIENT_RETRIES:
                await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2**attempt))
                continue
            return response
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_error = exc
            if attempt < MAX_TRANSIENT_RETRIES:
                await asyncio.sleep(RETRY_BASE_DELAY_SECONDS * (2**attempt))
                continue
            raise
    assert last_error is not None
    raise last_error


def _build_request_payload(
    model: str,
    messages: list[dict],
    tools: list[dict],
    dispatch_mode: str,
) -> tuple[dict[str, Any], bool]:
    if dispatch_mode == "wrapped":
        # 保留旧版单函数包装模式，便于做 native vs wrapped 协议修正率对照实验。
        dispatcher = {
            "type": "function",
            "function": {
                "name": "agentStep",
                "description": (
                    "Choose exactly one next action. Use finish to answer, clarify, or report out of scope. "
                    "Allowed actions and their JSON argument schemas: "
                    + json.dumps([tool["function"] for tool in tools])
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": [tool["function"]["name"] for tool in tools]},
                        "arguments": {
                            "type": "string",
                            "description": "JSON object serialized as a string, matching the chosen action schema.",
                        },
                    },
                    "required": ["action", "arguments"],
                    "additionalProperties": False,
                },
            },
        }
        wire_messages = []
        for message in messages:
            if message.get("tool_calls"):
                calls = [
                    {
                        **call,
                        "function": {
                            "name": "agentStep",
                            "arguments": json.dumps(
                                {"action": call["function"]["name"], "arguments": call["function"]["arguments"]}
                            ),
                        },
                    }
                    for call in message["tool_calls"]
                ]
                wire_messages.append({**message, "tool_calls": calls})
            else:
                wire_messages.append(message)
        return (
            {
                "model": model,
                "messages": wire_messages,
                "tools": [dispatcher],
                "tool_choice": {"type": "function", "function": {"name": "agentStep"}},
                "parallel_tool_calls": False,
                "temperature": 0,
                "max_tokens": 700,
                "enable_thinking": False,
            },
            True,
        )

    # 默认原生多工具调用模式：消除双重 JSON 字符串转义，显著降低协议修正率与冗余 Schema Token。
    return (
        {
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "required",
            "parallel_tool_calls": False,
            "temperature": 0,
            "max_tokens": 700,
            "enable_thinking": False,
        },
        False,
    )


async def call_model(messages: list[dict], tools: list[dict]) -> dict:
    key, models = _resolve_models()
    dispatch_mode = os.getenv("AGENT_TOOL_DISPATCH_MODE", "native").strip().lower()
    if dispatch_mode not in ("native", "wrapped"):
        dispatch_mode = "native"
    allowed_tool_names = {tool["function"]["name"] for tool in tools}
    skipped: list[str] = []
    client = get_http_client()
    url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")

    try:
        for model in models:
            body, is_wrapped = _build_request_payload(model, messages, tools, dispatch_mode)
            response = await _post_with_retry(client, url, {"Authorization": f"Bearer {key}"}, body)
            try:
                payload = response.json()
            except ValueError:
                raise AgentToolError("model_unavailable", "Model service returned invalid JSON.", 502) from None
            if not response.is_success:
                error = payload.get("error") if isinstance(payload, dict) else None
                if isinstance(error, dict) and error.get("code") == "AllocationQuota.FreeTierOnly":
                    skipped.append(model)
                    continue
                raise AgentToolError("model_unavailable", f"Model service returned HTTP {response.status_code}.", 502)

            if is_wrapped:
                reply = parse_reply(payload, named_tool=True)
                try:
                    action = json.loads(reply["call"]["function"]["arguments"])
                    if (
                        reply["call"]["function"]["name"] != "agentStep"
                        or not isinstance(action, dict)
                        or set(action) != {"action", "arguments"}
                    ):
                        raise ValueError("Invalid action envelope")
                    if action["action"] not in allowed_tool_names or not isinstance(action["arguments"], str):
                        raise ValueError("Invalid action")
                    reply["call"] = {
                        **reply["call"],
                        "function": {"name": action["action"], "arguments": action["arguments"]},
                    }
                except (ValueError, TypeError):
                    raise ProtocolError(reply["tokens"]) from None
            else:
                reply = parse_reply(payload, allowed_tools=allowed_tool_names)

            logger.info(
                json.dumps(
                    {
                        "event": "python_model_completed",
                        "model": model,
                        "dispatchMode": dispatch_mode,
                        "tokens": reply["tokens"],
                        "quotaSkippedModels": skipped,
                    }
                )
            )
            return {**reply, "model": model, "dispatchMode": dispatch_mode, "quotaSkippedModels": skipped}
    except httpx.HTTPError:
        raise AgentToolError(
            "model_unavailable",
            "Model request failed or timed out after bounded retries.",
            503,
        ) from None
    raise AgentToolError("model_free_quota_exhausted", "All configured free model quotas are exhausted.", 403)


async def synthesize_grounded_summary(
    user_message: str,
    structured_response: dict[str, Any],
) -> tuple[str | None, dict[str, int]]:
    """基于已验证的工具结果生成受控自然语言总结（不覆盖或编造价格/型号/适配结论）。

    若未启用（AGENT_ENABLE_SUMMARY=0）、未配置密钥或请求超时，安全返回 (None, zero_tokens)，
    由确定性模板兜底，确保主流程零回归风险。
    """
    zero = {"input": 0, "output": 0, "total": 0}
    if os.getenv("AGENT_ENABLE_SUMMARY", "1").strip() in ("0", "false", "False"):
        return None, zero
    key = os.getenv("DASHSCOPE_API_KEY", "").strip()
    if not key:
        return None, zero

    # 仅在存在实质检索/商品/适配/知识结果时做综合总结
    has_facts = bool(
        structured_response.get("products")
        or structured_response.get("knowledge")
        or structured_response.get("compatibility")
        or structured_response.get("sections")
    )
    if not has_facts or structured_response.get("intent") in ("out_of_scope", "clarification_needed"):
        return None, zero

    _, models = _resolve_models()
    client = get_http_client()
    url = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions")
    facts = {
        "intent": structured_response.get("intent"),
        "products": [
            {
                "partNumber": p.get("partNumber"),
                "name": p.get("name"),
                "price": p.get("price"),
                "availability": p.get("availability"),
                "brand": p.get("brand"),
                "symptoms": p.get("symptoms", []),
            }
            for p in (structured_response.get("products") or [])[:5]
        ],
        "compatibility": structured_response.get("compatibility"),
        "knowledge": [
            {
                "status": k.get("status"),
                "hits": [
                    {"title": h.get("title"), "heading": h.get("heading"), "summary": h.get("summary"), "safety": h.get("safety")}
                    for h in (k.get("hits") or [])[:3]
                ],
            }
            for k in (structured_response.get("knowledge") or [])[:2]
        ],
        "cartProposal": structured_response.get("cartProposal"),
    }
    sys_prompt = (
        "你是严谨的家电配件咨询助手总结器。请严格依据提供的 JSON 事实数据，用简洁中文（2-4 句话）回答用户问题或对比候选配件。"
        "硬性约束：1) 绝对禁止编造 JSON 中不存在的配件编号、价格、库存或适配结论；"
        "2) 若 compatibility.status 为 unknown 或无适配记录，必须明确提醒“尚未核验该型号适配性”；"
        "3) 若存在 cartProposal，提醒用户点击确认按钮才会加入购物车；"
        "4) 若知识摘要含安全提示，简要保留断电/断水提醒。"
    )
    try:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": models[0],
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": json.dumps({"userMessage": user_message, "verifiedFacts": facts}, ensure_ascii=False)},
                ],
                "temperature": 0.1,
                "max_tokens": 300,
                "enable_thinking": False,
            },
            timeout=10.0,
        )
        if not response.is_success:
            return None, zero
        payload = response.json()
        usage = payload.get("usage") or {}
        tokens = {
            "input": int(usage.get("prompt_tokens") or 0),
            "output": int(usage.get("completion_tokens") or 0),
            "total": int(usage.get("total_tokens") or 0),
        }
        text = (((payload.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        return (text if text else None), tokens
    except Exception:
        return None, zero
