import asyncio
import json

import httpx
import pytest

from app.agent.provider import ProtocolError, _build_request_payload, call_model, parse_reply
from app.agent.tools import TOOLS


def test_native_payload_uses_direct_tools_and_required_choice():
    body, is_wrapped = _build_request_payload("qwen-plus", [{"role": "user", "content": "hi"}], TOOLS, "native")
    assert not is_wrapped
    assert body["tool_choice"] == "required"
    assert body["parallel_tool_calls"] is False
    assert len(body["tools"]) == len(TOOLS)


def test_parse_reply_native_allows_stop_with_allowed_tool_only():
    call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "searchProducts", "arguments": json.dumps({"query": "ice maker"})},
    }
    payload = {
        "choices": [{"finish_reason": "stop", "message": {"content": "", "tool_calls": [call]}}],
        "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
    }
    parsed = parse_reply(payload, allowed_tools={"searchProducts", "finish"})
    assert parsed["call"]["function"]["name"] == "searchProducts"
    assert parsed["tokens"]["total"] == 30

    with pytest.raises(ProtocolError):
        parse_reply(payload, allowed_tools={"finish"})


def test_call_model_retries_transient_503_then_succeeds(monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "test-key")
    monkeypatch.setenv("DASHSCOPE_MODEL", "qwen-plus")
    monkeypatch.setenv("AGENT_TOOL_DISPATCH_MODE", "native")
    monkeypatch.setattr("app.agent.provider.RETRY_BASE_DELAY_SECONDS", 0.001)

    attempts = 0

    class FakeClient:
        is_closed = False

        async def post(self, url, headers=None, json=None, timeout=None):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(503, json={"error": {"message": "overloaded"}})
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "tool_calls",
                            "message": {
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "c1",
                                        "type": "function",
                                        "function": {"name": "finish", "arguments": '{"resultIds":[],"missing":"model"}'},
                                    }
                                ],
                            },
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                },
            )

    monkeypatch.setattr("app.agent.provider.get_http_client", lambda: FakeClient())
    result = asyncio.run(call_model([{"role": "user", "content": "hi"}], TOOLS))
    assert attempts == 2
    assert result["call"]["function"]["name"] == "finish"
    assert result["dispatchMode"] == "native"
