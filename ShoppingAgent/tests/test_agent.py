import asyncio
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.agent.graph import execute_graph, finish
from app.agent.models import AgentRequest
from app.agent.provider import ProtocolError, parse_reply
from app.agent.tools import run_tool, validate_arguments
from app.catalog.repository import CatalogRepository
from app.catalog.service import CatalogService
from app.main import app
from app.shared.errors import AgentToolError


def reply(call_id, name, arguments):
    return {"call": {"id": call_id, "type": "function", "function": {
        "name": name, "arguments": json.dumps(arguments)}}, "tokens": {"input": 10, "output": 5, "total": 15}}


def test_graph_rejects_invented_identifiers_then_reads_catalog(monkeypatch):
    catalog = CatalogService(CatalogRepository(Path(__file__).parents[1] / "data/parts-catalog.json"))
    monkeypatch.setattr("app.agent.tools.get_catalog_service", lambda: catalog)
    calls = iter([
        reply("invented", "getProductDetails", {"partNumber": "PS99999999"}),
        reply("details", "getProductDetails", {"partNumber": "PS11752778"}),
        reply("done", "finish", {"resultIds": ["details"], "missing": "none"}),
    ])
    async def model(messages, tools):
        return next(calls)
    result = asyncio.run(execute_graph(AgentRequest(message="Price of PS11752778", runId="test"), model))
    answer = result["response"]
    assert answer["products"][0]["price"] == 39.99
    assert result["memory"]["selectedPart"] == "PS11752778"
    assert [step["status"] for step in answer["trace"]] == ["error", "ok", "ok"]
    assert answer["tokens"]["total"] == 45


def test_no_write_tools_and_strict_arguments():
    for name, args in [("addToCart", {"partNumber": "PS11752778"}),
                       ("getProductDetails", {"partNumber": "PS11752778", "quantity": "2"})]:
        with pytest.raises(ValueError):
            validate_arguments(name, args)


def test_candidate_reference_preserves_order_and_part_is_not_a_model(monkeypatch):
    catalog = CatalogService(CatalogRepository(Path(__file__).parents[1] / "data/parts-catalog.json"))
    monkeypatch.setattr("app.agent.tools.get_catalog_service", lambda: catalog)
    monkeypatch.setattr("app.agent.graph.get_catalog_service", lambda: catalog)
    assert len(run_tool("searchProducts", {"query": "refrigerator parts"}, {})["products"]) >= 2
    candidates = [{"partNumber": part, "manufacturerPartNumber": part, "name": part}
                  for part in ("WPW10300024", "W10408179")]
    calls = iter([reply("detail", "getProductDetails", {"partNumber": "W10408179"}),
                  reply("done", "finish", {"resultIds": ["detail"], "missing": "none"})])
    async def model(messages, tools):
        return next(calls)
    result = asyncio.run(execute_graph(AgentRequest(message="Show the second one, W10408179", runId="candidate",
        memory={"candidates": candidates}), model))
    assert result["memory"]["candidates"] == candidates
    assert result["memory"]["selectedPart"] == "W10408179"
    assert result["memory"]["currentModelNumber"] is None
    assert all(step["status"] == "ok" for step in result["response"]["trace"])


def test_graph_has_bounded_calls_and_failure_diagnostics():
    count = 0
    async def model(messages, tools):
        nonlocal count
        count += 1
        return reply(str(count), "addToCart", {"partNumber": "PS11752778"})
    with pytest.raises(AgentToolError) as failure:
        asyncio.run(execute_graph(AgentRequest(message="PS11752778", runId="budget"), model))
    assert failure.value.code == "agent_step_limit"
    assert count == 6
    assert len(failure.value.details["response"]["trace"]) == 6
    assert failure.value.details["response"]["tokens"]["total"] == 90


def test_protocol_failure_retains_tokens():
    with pytest.raises(ProtocolError) as failure:
        parse_reply({"choices": [{"finish_reason": "stop", "message": {"content": "text"}}],
                     "usage": {"prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9}})
    assert failure.value.tokens["total"] == 9
    call = reply("named", "agentStep", {"action": "finish", "arguments": "{}"})["call"]
    payload = {"choices": [{"finish_reason": "stop", "message": {"content": "", "tool_calls": [call]}}]}
    assert parse_reply(payload, named_tool=True)["call"] == call
    with pytest.raises(ProtocolError):
        parse_reply(payload)
    payload["choices"][0]["finish_reason"] = "length"
    with pytest.raises(ProtocolError):
        parse_reply(payload, named_tool=True)


def test_http_request_rejects_extra_fields_before_model_call():
    with TestClient(app) as client:
        response = client.post("/agent/run", json={"message": "Price?", "runId": "test", "apiKey": "not-accepted"})
    assert response.status_code == 422


def test_finish_cannot_hide_evidence_or_keep_conflicting_proposal():
    results = {
        "proposal": {"intent": "cart_action", "tool": "prepareCartAddition", "message": "Review addition",
                     "cartProposal": {"partNumber": "PS11752778"}},
        "evidence": {"intent": "compatibility_check", "tool": "checkCompatibility", "message": "Unknown fit",
                     "compatibility": {"partNumber": "PS11752778", "modelNumber": "WDT780SAEM1", "status": "unknown"}},
    }
    with pytest.raises(ValueError):
        finish({"resultIds": ["proposal"], "missing": "none"}, results)
    answer = finish({"resultIds": ["proposal", "evidence"], "missing": "none"}, results)
    assert "cartProposal" not in answer and "withdrawn" in answer["message"]
    results["other"] = {"intent": "compatibility_check", "tool": "checkCompatibility", "message": "Other fit",
                        "compatibility": {"partNumber": "WPW10448645", "modelNumber": "ADB1500ADB1", "status": "compatible"}}
    answer = finish({"resultIds": ["proposal", "evidence", "other"], "missing": "none"}, results)
    assert len(answer["compatibilities"]) == 2 and answer["compatibilities"][0]["status"] == "unknown"


def test_chinese_adjacent_model_replaces_previous_context():
    async def model(messages, tools):
        return reply("done", "finish", {"resultIds": [], "missing": "model"})
    result = asyncio.run(execute_graph(AgentRequest(message="型号改成ADB1500ADB99", runId="chinese",
        memory={"currentModelNumber": "WSF26C3EXF01"}), model))
    assert result["memory"]["currentModelNumber"] == "ADB1500ADB99"


def test_known_model_blocks_proposal_before_tool_execution(monkeypatch):
    def forbidden(*args):
        raise AssertionError("Proposal tool must not execute before evidence.")
    monkeypatch.setattr("app.agent.graph.run_tool", forbidden)
    calls = iter([reply("proposal", "prepareCartAddition", {"partNumber": "PS11752778", "quantity": "2"}),
                  reply("done", "finish", {"resultIds": [], "missing": "model"})])
    async def model(messages, tools):
        return next(calls)
    result = asyncio.run(execute_graph(AgentRequest(message="Add PS11752778 for WDT780SAEM1", runId="guard"), model))
    assert result["response"]["trace"][0]["status"] == "error"
    assert "cartProposal" not in result["response"]


def test_stream_endpoint_emits_progress_and_result(monkeypatch):
    catalog = CatalogService(CatalogRepository(Path(__file__).parents[1] / "data/parts-catalog.json"))
    monkeypatch.setattr("app.agent.tools.get_catalog_service", lambda: catalog)
    monkeypatch.setattr("app.agent.graph.get_catalog_service", lambda: catalog)

    async def fake_execute(request, on_event=None):
        if on_event is not None:
            await on_event({"type": "progress", "stage": "tool_start", "tool": "searchProducts", "label": "正在检索配件目录..."})
        return {
            "response": {
                "intent": "part_lookup",
                "tool": "searchProducts",
                "message": "Found PS11752778",
                "executionMode": "python_graph",
                "groundedSummary": "找到冰箱门搁架 PS11752778（演示价 $39.99）。",
            },
            "memory": request.memory.model_dump(),
        }

    monkeypatch.setattr("app.agent.router.execute_graph", fake_execute)
    with TestClient(app) as client:
        res = client.post("/agent/stream", json={"message": "PS11752778", "runId": "stream-1"})
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]
    assert "event: progress" in res.text
    assert "event: result" in res.text
    assert "groundedSummary" in res.text
