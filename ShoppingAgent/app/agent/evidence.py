"""纯 Python 实现的只读证据工具（适配核验、安装指引、排障流程）。

取代原 Node/tsx 子进程桥接，消除每次工具调用的跨进程冷启动开销与镜像 Node 依赖。
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from app.catalog.router import get_catalog_service
from app.shared.errors import AgentToolError

REVIEWED_TTL_SECONDS = 90 * 24 * 60 * 60
PART_NOT_FOUND_MESSAGE = (
    "I could not find a matching refrigerator or dishwasher part in the local catalog. "
    "Please share the exact part number or appliance model number."
)


def is_partselect_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (host == "partselect.com" or host.endswith(".partselect.com"))


def _default_evidence_path() -> Path:
    return Path(__file__).resolve().parents[2] / "data" / "evidence-data.json"


@lru_cache(maxsize=4)
def _load_evidence_data_cached(path_str: str, mtime_ns: int) -> dict[str, Any]:
    del mtime_ns  # 用于缓存失效键
    data = json.loads(Path(path_str).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Invalid evidence data format.")
    return data


def load_evidence_data() -> dict[str, Any]:
    path = Path(os.environ.get("SHOPPING_AGENT_EVIDENCE_PATH", str(_default_evidence_path())))
    try:
        stat = path.stat()
        return _load_evidence_data_cached(str(path), stat.st_mtime_ns)
    except (OSError, ValueError) as exc:
        raise AgentToolError(
            "evidence_tool_unavailable",
            "The read-only evidence dataset is unavailable.",
            503,
        ) from exc


def _normalize(value: str) -> str:
    return value.strip().upper()


def _parse_iso_timestamp(value: str | None) -> float | None:
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return None


def evaluate_compatibility(
    part_number: str,
    model_number: str,
    records: list[dict[str, Any]],
    *,
    now_ts: float | None = None,
) -> dict[str, Any]:
    part = _normalize(part_number)
    model = _normalize(model_number)
    current_ts = now_ts if now_ts is not None else datetime.now(timezone.utc).timestamp()

    evidence: list[dict[str, Any]] = []
    for record in records:
        source = record.get("source") or {}
        excerpt = str(record.get("excerpt") or "").strip()
        if (
            _normalize(str(record.get("partNumber") or "")) == part
            and _normalize(str(record.get("modelNumber") or "")) == model
            and len(excerpt) > 0
            and is_partselect_url(str(source.get("url") or ""))
        ):
            evidence.append(record)

    live: list[dict[str, Any]] = []
    for record in evidence:
        source = record.get("source") or {}
        origin = source.get("origin")
        if origin == "live":
            live.append(record)
        elif origin == "reviewed":
            retrieved_ts = _parse_iso_timestamp(source.get("retrievedAt"))
            if retrieved_ts is not None:
                age = current_ts - retrieved_ts
                if 0 <= age <= REVIEWED_TTL_SECONDS:
                    live.append(record)

    supports = any(record.get("verdict") == "compatible" for record in live)
    excludes = any(record.get("verdict") == "incompatible" for record in live)
    if supports == excludes:
        status = "unknown"
    elif supports:
        status = "compatible"
    else:
        status = "incompatible"

    if supports and excludes:
        reason = "conflicting_evidence"
    elif supports:
        reason = "supported"
    elif excludes:
        reason = "explicit_exclusion"
    elif any((record.get("source") or {}).get("origin") == "demo" for record in evidence):
        reason = "demo_only"
    else:
        reason = "no_evidence"

    if status == "unknown":
        next_action = "Confirm the full model label and verify fit with the manufacturer or supplier before buying."
    elif status == "incompatible":
        next_action = "Do not use this part for the specified model; find an explicitly supported replacement."
    else:
        next_action = "Confirm the complete model suffix and the supplier's current fit information before buying."

    return {
        "partNumber": part,
        "modelNumber": model,
        "status": status,
        "reason": reason,
        "evidence": evidence,
        "nextAction": next_action,
    }


def _build_compatibility_message(result: dict[str, Any]) -> str:
    part = result["partNumber"]
    model = result["modelNumber"]
    status = result["status"]
    reason = result["reason"]
    if status == "compatible":
        return (
            f"Reviewed/verified evidence supports compatibility between {part} and model {model}. "
            f"{result['nextAction']}"
        )
    if status == "incompatible":
        return (
            f"Evidence indicates {part} is NOT compatible with model {model}. "
            f"{result['nextAction']}"
        )
    if reason == "conflicting_evidence":
        return (
            f"Compatibility between {part} and model {model} is unknown due to conflicting evidence. "
            f"{result['nextAction']}"
        )
    if reason == "demo_only":
        return (
            f"Compatibility between {part} and model {model} is unknown (only unverified demonstration catalog data exists). "
            f"{result['nextAction']}"
        )
    return (
        f"Compatibility between {part} and model {model} is unknown because no valid matching evidence was found. "
        f"{result['nextAction']}"
    )


def _find_catalog_product(part_number: str):
    normalized = _normalize(part_number)
    service = get_catalog_service()
    for item in service.repository.list_products():
        if _normalize(item.id) == normalized or _normalize(getattr(item, "manufacturer_part_number", "") or "") == normalized:
            return item
    return None


def _product_view_from_item(item: Any) -> dict[str, Any]:
    price = float(item.price) if item.price is not None else None
    availability = (
        "Out of stock"
        if not item.available or item.stock_qty == 0
        else "Unknown"
        if item.stock_qty is None
        else "In stock"
    )
    return {
        "partNumber": item.id,
        "manufacturerPartNumber": getattr(item, "manufacturer_part_number", None) or item.id,
        "name": item.name,
        "description": getattr(item, "description", None) or "Catalog entry; verify details with the manufacturer.",
        "applianceType": item.category,
        "brand": getattr(item, "brand", None) or "Unknown",
        "price": price,
        "availability": availability,
        "compatibleModels": list(getattr(item, "compatible_models", None) or []),
        "symptoms": list(getattr(item, "symptoms", None) or []),
        "installationSteps": list(getattr(item, "installation_steps", None) or []),
        "sourceUrl": getattr(item, "source_url", None) or "",
        "sourceType": "product",
        "catalogOrigin": getattr(item, "data_origin", None) or "demo_seed",
        "purchasable": bool(item.available) and price is not None and (item.stock_qty is None or item.stock_qty > 0),
    }


def check_compatibility(part_number: str, model_number: str) -> dict[str, Any]:
    data = load_evidence_data()
    part = _normalize(part_number)
    model = _normalize(model_number)

    records: list[dict[str, Any]] = list(data.get("reviewedCompatibility") or [])

    product = _find_catalog_product(part)
    if product is not None:
        demo_details = (data.get("demoPartDetails") or {}).get(product.id, {})
        demo_models = list(getattr(product, "compatible_models", None) or demo_details.get("compatibleModels") or [])
        for listed in demo_models:
            if _normalize(str(listed)) == model:
                records.append(
                    {
                        "partNumber": part,
                        "modelNumber": model,
                        "verdict": "compatible",
                        "excerpt": str(listed),
                        "source": {
                            "title": f"{product.id} demo catalog model list",
                            "url": getattr(product, "source_url", "") or "",
                            "type": "compatibility",
                            "origin": "demo",
                        },
                    }
                )
                break

    result = evaluate_compatibility(part, model, records)
    return {
        "intent": "compatibility_check",
        "tool": "checkCompatibility",
        "message": _build_compatibility_message(result),
        "compatibility": result,
        "groundingStatus": "unverified",
        "sources": [item["source"] for item in result["evidence"]],
    }


def get_installation_guide(part_number: str) -> dict[str, Any]:
    data = load_evidence_data()
    part = _normalize(part_number)
    product = _find_catalog_product(part)

    if product is None:
        return {
            "intent": "installation_guide",
            "tool": "getInstallationGuide",
            "message": PART_NOT_FOUND_MESSAGE,
            "steps": [],
            "groundingStatus": "demo_fallback",
            "sources": [],
        }

    demo_details = (data.get("demoPartDetails") or {}).get(product.id, {})
    steps = list(getattr(product, "installation_steps", None) or demo_details.get("installationSteps") or [])
    if steps:
        message = (
            f"以下是 {part} 的演示安装步骤，未经针对该型号的核验。"
            "操作前请核对厂家说明并断电断水；不确定时请联系专业人员。"
        )
    else:
        message = f"暂无 {part} 的可靠安装步骤。请查看厂家说明或商品来源，不要据此自行拆装。"

    source_url = getattr(product, "source_url", "") or ""
    sources = (
        [{"title": product.name, "url": source_url, "type": "installation", "origin": "demo"}]
        if source_url
        else []
    )
    return {
        "intent": "installation_guide",
        "tool": "getInstallationGuide",
        "message": message,
        "steps": steps,
        "groundingStatus": "demo_fallback",
        "sources": sources,
    }


def get_troubleshooting_flow(query: str, appliance_type: str | None = None) -> dict[str, Any]:
    data = load_evidence_data()
    guides = list(data.get("troubleshootingGuides") or [])
    lowered = query.lower()

    matched_guide = None
    best_score = 0
    for guide in guides:
        score = sum(len(kw) for kw in guide.get("keywords", []) if kw.lower() in lowered)
        if score > best_score:
            best_score = score
            matched_guide = guide

    service = get_catalog_service()
    if matched_guide is not None:
        recommended_products = []
        for part_id in matched_guide.get("likelyParts", []):
            prod = _find_catalog_product(part_id)
            if prod is not None:
                recommended_products.append(_product_view_from_item(prod))
        issue = matched_guide["issue"]
        checklist = list(matched_guide["diagnosticFlow"])
        causes = list(matched_guide["possibleCauses"])
        source_url = matched_guide["sourceUrl"]
    else:
        search_res = service.search_products(
            q=query,
            category=appliance_type if appliance_type in ("refrigerator", "dishwasher") else None,
            available_only=False,
            limit=2,
        )
        recommended_products = [_product_view_from_item(item) for item in search_res.results]
        issue = "General appliance troubleshooting"
        checklist = [
            "Confirm the appliance has power and is running a normal cycle.",
            "Inspect visible components, hoses, filters, seals, and spray arms for damage or blockage.",
            "Match the symptom to the most likely failing assembly.",
            "Share a model number if you want compatibility narrowed down further.",
        ]
        causes = [
            "Blocked water path",
            "Worn mechanical part",
            "Improperly seated component",
            "Compatibility issue with the current model",
        ]
        source_url = "https://www.partselect.com/Repair/General-Appliance-Troubleshooting.htm"

    return {
        "intent": "troubleshooting",
        "tool": "getTroubleshootingFlow",
        "message": (
            "This is a demonstration diagnostic checklist, not a verified diagnosis. "
            "Disconnect power/water before physical inspection and consult a qualified technician when unsure."
        ),
        "sections": [
            {"title": issue, "items": checklist},
            {"title": "Possible causes (unverified)", "items": causes},
        ],
        "products": recommended_products,
        "groundingStatus": "demo_fallback",
        "sources": [{"title": issue, "url": source_url, "type": "troubleshooting", "origin": "demo"}],
    }


def run_evidence_tool(name: str, args: dict[str, str], memory: dict[str, Any]) -> dict[str, Any]:
    if name == "checkCompatibility":
        return check_compatibility(args["partNumber"], args["modelNumber"])
    if name == "getInstallationGuide":
        return get_installation_guide(args["partNumber"])
    if name == "getTroubleshootingFlow":
        return get_troubleshooting_flow(args["query"], memory.get("applianceType"))
    raise ValueError("Evidence tool is not permitted.")
