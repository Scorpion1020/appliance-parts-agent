"""读取现有构建产物，保持与前端 BM25 的检索和引用契约一致。

支持动态品牌识别与中英双语领域同义词改写，解决原生中文查询在英文知识库上零召回的问题。
"""

import json
import math
import os
import re
import unicodedata
from pathlib import Path

from app.shared.errors import AgentToolError

STOP_WORDS = set(
    "a an the of to for with in on at is are was were be been being do does did can could would should will shall "
    "i my me we our you your it its this that these those and or but if as from by about how what when where why "
    "which not no has have had please tell give some".split()
)
BROAD_TERMS = set("dishwasher refrigerator fridge whirlpool ge appliance help problem guide manual".split())
OUT_OF_SCOPE_APPLIANCES = re.compile(
    r"\b(microwave|washing\s+machine|washer|dryer|oven|stove|range|toaster|coffee\s+maker)\b|洗衣机|微波炉|烤箱|烘干机",
    re.I,
)
KNOWN_EXTERNAL_BRANDS = re.compile(
    r"\b(samsung|lg|bosch|frigidaire|electrolux|midea|haier|siemens|panasonic|kenmore)\b|三星|博世|西门子|美的|海尔",
    re.I,
)

# 可配置的中英双语及英文同义词映射表（用于查询归一化与召回增强）
ZH_EN_SYNONYMS: list[tuple[str, str]] = [
    ("洗碗机", "dishwasher"),
    ("冰箱", "refrigerator"),
    ("冷冻室", "freezer"),
    ("冷藏室", "refrigerator fresh food"),
    ("惠而浦", "Whirlpool"),
    ("通用电气", "GE"),
    ("不排水", "drainage standing water drain"),
    ("积水", "standing water drain"),
    ("排水", "drainage drain"),
    ("异响", "noise sounds unusual"),
    ("噪音", "noise sounds"),
    ("声音", "sounds noise"),
    ("不制冷", "not cooling warm"),
    ("温度高", "warm cooling"),
    ("结霜", "frost defrost ice buildup"),
    ("除霜", "defrost frost"),
    ("门关不严", "door not closing gasket seal"),
    ("门封", "door gasket seal"),
    ("漏水", "leaking water seal gasket"),
    ("冷凝器", "condenser coils"),
    ("盘管", "condenser coils"),
    ("滤网", "filter cleaning"),
    ("过滤网", "filter cleaning"),
    ("滤芯", "water filter replacement"),
    ("制冰机", "ice maker"),
    ("不制冰", "ice maker not making ice"),
    ("无法启动", "will not start"),
    ("启动不了", "will not start"),
    ("烘干", "drying heating element rinse aid"),
    ("洗不干净", "poor cleaning dirty dishes spray arm"),
    ("异味", "odor smell cleaning filter"),
    ("喷淋臂", "spray arm"),
]

EN_SYNONYMS: list[tuple[str, str]] = [
    (r"\bfridge\b", "refrigerator"),
    (r"\bshut\b", "close closing"),
    (r"\bclogged\b", "blocked obstruction"),
    (r"\bsmell\b", "odor"),
    (r"\bstinky\b", "odor"),
    (r"\bwet dishes\b", "drying rinse aid"),
]


def rewrite_query(query: str) -> str:
    """将中英文混合/口语化问法归一化为适合索引检索的英文扩展查询。"""
    expanded = query
    for zh_term, en_term in ZH_EN_SYNONYMS:
        if zh_term in expanded:
            expanded = f"{expanded} {en_term}"
    for pattern, replacement in EN_SYNONYMS:
        expanded = re.sub(pattern, replacement, expanded, flags=re.I)
    return expanded.strip()


def tokenize(text: str) -> list[str]:
    terms = re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", unicodedata.normalize("NFKC", text).lower())
    return [
        term
        if re.search(r"\d", term)
        else term[:-3]
        if len(term) > 5 and term.endswith("ing")
        else term[:-1]
        if len(term) > 4 and term.endswith("s")
        else term
        for term in terms
        if term not in STOP_WORDS
    ]


def load_index() -> dict:
    default = Path(__file__).resolve().parents[3] / "PartSelectChatAgent/data/generated/knowledge-index.json"
    path = Path(os.environ.get("SHOPPING_AGENT_KNOWLEDGE_INDEX", str(default)))
    try:
        index = json.loads(path.read_text(encoding="utf-8"))
        if index["schemaVersion"] != 1 or not index["documents"] or not index["chunks"]:
            raise ValueError("Invalid index")
        return index
    except (OSError, ValueError, KeyError, TypeError):
        raise AgentToolError(
            "knowledge_unavailable",
            "The reviewed knowledge index is unavailable. Build and check the knowledge resources first.",
            503,
        ) from None


def search_index(index: dict, query: str, appliance: str | None = None) -> dict:
    normalized = rewrite_query(query)
    terms = list(dict.fromkeys(tokenize(normalized)))
    topical = [term for term in terms if term not in BROAD_TERMS]
    base = {"indexVersion": index["indexVersion"], "method": "bm25", "rewrittenQuery": normalized}
    if not topical:
        return {**base, "status": "insufficient_query", "hits": []}
    if OUT_OF_SCOPE_APPLIANCES.search(query):
        return {**base, "status": "no_evidence", "hits": []}

    identifiers = [term for term in terms if re.search(r"[a-z]", term) and re.search(r"\d", term)]
    documents = {doc["id"]: doc for doc in index["documents"]}
    # 动态从索引文档元数据提取品牌列表，避免硬编码
    known_brands = sorted({str(doc.get("brand") or "").strip() for doc in index["documents"] if doc.get("brand")})
    brands = [brand for brand in known_brands if re.search(r"\b" + re.escape(brand) + r"\b", normalized, re.I)]
    if not brands and KNOWN_EXTERNAL_BRANDS.search(query):
        return {**base, "status": "no_evidence", "hits": []}

    corpus = [
        chunk
        for chunk in index["chunks"]
        if chunk["documentId"] in documents
        and (not appliance or documents[chunk["documentId"]]["applianceType"] == appliance)
        and (not brands or documents[chunk["documentId"]]["brand"] in brands)
    ]
    if not corpus:
        return {**base, "status": "no_evidence", "hits": []}

    average = sum(chunk["length"] for chunk in corpus) / len(corpus)
    frequencies = {term: sum(chunk["terms"].get(term, 0) > 0 for chunk in corpus) for term in terms}
    hits = []
    for chunk in corpus:
        counts = chunk["terms"]
        if not any(counts.get(term, 0) for term in topical) or any(not counts.get(term, 0) for term in identifiers):
            continue
        score = 0.0
        for term in terms:
            count = counts.get(term, 0)
            if count:
                inverse = math.log(1 + (len(corpus) - frequencies[term] + 0.5) / (frequencies[term] + 0.5))
                score += inverse * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * chunk["length"] / average))
        doc = documents[chunk["documentId"]]
        hits.append(
            {
                "chunkId": chunk["id"],
                "documentId": doc["id"],
                "documentVersion": chunk["documentVersion"],
                "title": doc["title"],
                "heading": chunk["heading"],
                "summary": chunk["text"],
                "sourceUrl": doc["url"],
                "reviewedAt": doc["reviewedAt"],
                "sourceKind": doc["sourceKind"],
                "scope": doc["scope"],
                "safety": doc["safety"],
                "score": round(score, 4),
            }
        )
    hits.sort(key=lambda hit: (-hit["score"], hit["chunkId"]))
    return {**base, "status": "found" if hits else "no_evidence", "hits": hits[:3]}


def search_knowledge(query: str, appliance: str | None) -> dict:
    rewritten = rewrite_query(query)
    if re.search(r"\bdishwasher\b", rewritten, re.I):
        appliance = "dishwasher"
    elif re.search(r"\b(fridge|refrigerator)\b", rewritten, re.I):
        appliance = "refrigerator"
    method = os.environ.get("SHOPPING_AGENT_RETRIEVAL", "bm25")
    if method == "hybrid":
        from app.agent.vector_search import hybrid_search

        result = hybrid_search(load_index(), query, appliance)
    elif method == "bm25":
        result = search_index(load_index(), query, appliance)
    else:
        raise AgentToolError("retrieval_not_configured", "Use bm25 or hybrid retrieval.", 503)
    messages = {
        "found": "I found reviewed summaries of manufacturer guidance. These are general maintenance notes, not a diagnosis, a live-page check, or proof of parts compatibility. Read the source and your model's manual before acting.",
        "insufficient_query": "Please describe the maintenance topic or symptom you want to look up.",
        "no_evidence": "The current knowledge collection has no matching evidence for this question. This does not prove that a fault or compatibility relationship is absent. Check the exact model's manual or contact the manufacturer.",
    }
    return {
        "intent": "knowledge_lookup",
        "tool": "searchKnowledge",
        "groundingStatus": "unverified",
        "message": messages[result["status"]],
        "knowledge": [result],
        "sources": [],
    }
