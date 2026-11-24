from datetime import datetime, timezone
from pathlib import Path

from app.agent.evidence import (
    check_compatibility,
    evaluate_compatibility,
    get_installation_guide,
    get_troubleshooting_flow,
    is_partselect_url,
)
from app.catalog.repository import CatalogRepository
from app.catalog.service import CatalogService


def _setup_catalog(monkeypatch):
    catalog = CatalogService(CatalogRepository(Path(__file__).parents[1] / "data/parts-catalog.json"))
    monkeypatch.setattr("app.agent.evidence.get_catalog_service", lambda: catalog)
    return catalog


def test_is_partselect_url_validation():
    assert is_partselect_url("https://www.partselect.com/PS11752778.htm")
    assert is_partselect_url("https://partselect.com/Repair/Test.htm")
    assert not is_partselect_url("http://www.partselect.com/PS11752778.htm")
    assert not is_partselect_url("https://evil-partselect.com/PS11752778.htm")
    assert not is_partselect_url("https://example.com/PS11752778.htm")


def test_evaluate_compatibility_ttl_and_conflicts():
    now_ts = datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp()
    valid_reviewed = {
        "partNumber": "PS11752778",
        "modelNumber": "WSF26C3EXF01",
        "verdict": "compatible",
        "excerpt": "Confirmed match",
        "source": {
            "title": "Reviewed",
            "type": "compatibility",
            "origin": "reviewed",
            "retrievedAt": "2026-10-01T00:00:00Z",
            "url": "https://www.partselect.com/PS11752778.htm",
        },
    }
    res = evaluate_compatibility("PS11752778", "WSF26C3EXF01", [valid_reviewed], now_ts=now_ts)
    assert res["status"] == "compatible"
    assert res["reason"] == "supported"

    # Expired (>90 days)
    future_ts = datetime(2027, 2, 1, tzinfo=timezone.utc).timestamp()
    expired = evaluate_compatibility("PS11752778", "WSF26C3EXF01", [valid_reviewed], now_ts=future_ts)
    assert expired["status"] == "unknown"
    assert expired["reason"] == "no_evidence"

    # Conflict with live exclusion
    live_exclude = {
        "partNumber": "PS11752778",
        "modelNumber": "WSF26C3EXF01",
        "verdict": "incompatible",
        "excerpt": "Does not fit",
        "source": {
            "title": "Live check",
            "type": "compatibility",
            "origin": "live",
            "url": "https://www.partselect.com/PS11752778.htm",
        },
    }
    conflict = evaluate_compatibility("PS11752778", "WSF26C3EXF01", [valid_reviewed, live_exclude], now_ts=now_ts)
    assert conflict["status"] == "unknown"
    assert conflict["reason"] == "conflicting_evidence"


def test_pure_python_evidence_tools(monkeypatch):
    _setup_catalog(monkeypatch)
    # Demo-only model list never proves compatibility
    demo_res = check_compatibility("WPW10300024", "WRS588FIHZ00")
    assert demo_res["compatibility"]["status"] == "unknown"
    assert demo_res["compatibility"]["reason"] == "demo_only"

    # Installation guide with steps vs without steps
    guide = get_installation_guide("WPW10300024")
    assert len(guide["steps"]) == 5
    no_steps = get_installation_guide("PS11752778")
    assert no_steps["steps"] == []

    # Troubleshooting guide match
    ts = get_troubleshooting_flow("my ice maker is not working", "refrigerator")
    assert ts["tool"] == "getTroubleshootingFlow"
    assert ts["sections"][0]["title"] == "ice maker not working"
    assert len(ts["products"]) >= 1
