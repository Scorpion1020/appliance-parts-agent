"""分层检索评测基准（覆盖英文、原生中文改写、品牌过滤与无证据拒答）。

用法：
  python -m app.agent.eval_benchmark --output ../PartSelectChatAgent/evals/reports/retrieval-benchmark-v2.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any

from app.agent.knowledge import load_index, search_index

BENCHMARK_CASES: list[dict[str, Any]] = [
    # --- 英文正向检索（覆盖全部 15 份文档） ---
    {"id": "en-01", "group": "en_positive", "query": "GE dishwasher lights on but will not start", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-start"},
    {"id": "en-02", "group": "en_positive", "query": "GE refrigerator warm not cooling enough", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-cooling"},
    {"id": "en-03", "group": "en_positive", "query": "GE freezer door will not shut completely", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-door"},
    {"id": "en-04", "group": "en_positive", "query": "GE refrigerator unusual humming noise", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-noise"},
    {"id": "en-05", "group": "en_positive", "query": "GE dishwasher standing water not draining", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-drain"},
    {"id": "en-06", "group": "en_positive", "query": "Whirlpool dishwasher filter cleaning design", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-filter"},
    {"id": "en-07", "group": "en_positive", "query": "Whirlpool refrigerator condenser coils maintenance", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-coils"},
    {"id": "en-08", "group": "en_positive", "query": "Whirlpool ice maker not making ice shutoff arm", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-icemaker"},
    {"id": "en-09", "group": "en_positive", "query": "Whirlpool replace water filter cartridge flush air", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-water-filter"},
    {"id": "en-10", "group": "en_positive", "query": "Whirlpool freezer frost buildup defrost cycle", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-frost"},
    {"id": "en-11", "group": "en_positive", "query": "Whirlpool dishwasher dishes wet not drying rinse aid", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-drying"},
    {"id": "en-12", "group": "en_positive", "query": "Whirlpool dishwasher bad odor smell tub cleaning", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-odor"},
    {"id": "en-13", "group": "en_positive", "query": "GE dishwasher cloudy glasses poor cleaning spray arm", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-cleaning"},
    {"id": "en-14", "group": "en_positive", "query": "GE dishwasher leaking water front door oversudsing", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-leaking"},
    {"id": "en-15", "group": "en_positive", "query": "GE refrigerator slow water dispenser frozen line", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-dispenser"},
    {"id": "en-16", "group": "en_positive", "query": "dishwasher high loop disposer plug drainage", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-drain"},
    {"id": "en-17", "group": "en_positive", "query": "fridge coils vacuum dust cleaning", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-coils"},
    {"id": "en-18", "group": "en_positive", "query": "hollow ice cubes water pressure supply line", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-icemaker"},
    {"id": "en-19", "group": "en_positive", "query": "plastic dishes still wet after heated dry", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-drying"},
    {"id": "en-20", "group": "en_positive", "query": "hard water mineral film detergent tablets", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-cleaning"},
    # --- 原生中文正向检索（验证双语改写） ---
    {"id": "zh-01", "group": "zh_bilingual", "query": "GE洗碗机不排水积水怎么办", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-drain"},
    {"id": "zh-02", "group": "zh_bilingual", "query": "GE冰箱有异响正常吗", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-noise"},
    {"id": "zh-03", "group": "zh_bilingual", "query": "GE冰箱门关不严怎么办", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-door"},
    {"id": "zh-04", "group": "zh_bilingual", "query": "惠而浦冰箱冷凝器盘管怎么清理", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-coils"},
    {"id": "zh-05", "group": "zh_bilingual", "query": "惠而浦洗碗机过滤网怎么清洗", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-filter"},
    {"id": "zh-06", "group": "zh_bilingual", "query": "惠而浦冰箱制冰机不制冰怎么检查", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-icemaker"},
    {"id": "zh-07", "group": "zh_bilingual", "query": "惠而浦冰箱滤芯多久换一次", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-water-filter"},
    {"id": "zh-08", "group": "zh_bilingual", "query": "惠而浦冰箱冷冻室结霜严重", "appliance": "refrigerator", "expected_doc": "whirlpool-refrigerator-frost"},
    {"id": "zh-09", "group": "zh_bilingual", "query": "惠而浦洗碗机烘干不好", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-drying"},
    {"id": "zh-10", "group": "zh_bilingual", "query": "惠而浦洗碗机有异味怎么清洁", "appliance": "dishwasher", "expected_doc": "whirlpool-dishwasher-odor"},
    {"id": "zh-11", "group": "zh_bilingual", "query": "GE洗碗机漏水怎么排查", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-leaking"},
    {"id": "zh-12", "group": "zh_bilingual", "query": "GE洗碗机洗不干净喷淋臂堵塞", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-cleaning"},
    {"id": "zh-13", "group": "zh_bilingual", "query": "GE洗碗机通电但是无法启动", "appliance": "dishwasher", "expected_doc": "ge-dishwasher-start"},
    {"id": "zh-14", "group": "zh_bilingual", "query": "GE冰箱不制冷温度高", "appliance": "refrigerator", "expected_doc": "ge-refrigerator-cooling"},
    # --- 负样本 / 拒答 / 未知型号隔离 ---
    {"id": "neg-01", "group": "negative_refusal", "query": "microwave turntable motor replacement", "appliance": None, "expected_status": "no_evidence"},
    {"id": "neg-02", "group": "negative_refusal", "query": "washing machine spin cycle vibration", "appliance": None, "expected_status": "no_evidence"},
    {"id": "neg-03", "group": "negative_refusal", "query": "Samsung refrigerator error code 22E", "appliance": "refrigerator", "expected_status": "no_evidence"},
    {"id": "neg-04", "group": "negative_refusal", "query": "WDT999UNKNOWN123 drainage schematic", "appliance": "dishwasher", "expected_status": "no_evidence"},
    {"id": "neg-05", "group": "negative_refusal", "query": "dishwasher help", "appliance": "dishwasher", "expected_status": "insufficient_query"},
    {"id": "neg-06", "group": "negative_refusal", "query": "   ", "appliance": None, "expected_status": "insufficient_query"},
]


def run_benchmark() -> dict[str, Any]:
    index = load_index()
    latencies_ms: list[float] = []
    positive_total = 0
    recall_at_1 = 0
    recall_at_3 = 0
    mrr_sum = 0.0
    negative_total = 0
    negative_passed = 0
    details: list[dict[str, Any]] = []

    for case in BENCHMARK_CASES:
        t0 = time.perf_counter()
        result = search_index(index, case["query"], case["appliance"])
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 3)
        latencies_ms.append(elapsed_ms)
        hit_docs = [hit["documentId"] for hit in result["hits"]]

        if "expected_doc" in case:
            positive_total += 1
            expected = case["expected_doc"]
            rank = (hit_docs.index(expected) + 1) if expected in hit_docs else None
            if rank == 1:
                recall_at_1 += 1
            if rank is not None and rank <= 3:
                recall_at_3 += 1
                mrr_sum += 1.0 / rank
            passed = rank is not None
            details.append(
                {
                    "id": case["id"],
                    "group": case["group"],
                    "passed": passed,
                    "rank": rank,
                    "expected_doc": expected,
                    "top_docs": hit_docs,
                    "elapsed_ms": elapsed_ms,
                }
            )
        else:
            negative_total += 1
            expected_status = case["expected_status"]
            passed = result["status"] == expected_status and len(hit_docs) == 0
            if passed:
                negative_passed += 1
            details.append(
                {
                    "id": case["id"],
                    "group": case["group"],
                    "passed": passed,
                    "expected_status": expected_status,
                    "actual_status": result["status"],
                    "elapsed_ms": elapsed_ms,
                }
            )

    sorted_lat = sorted(latencies_ms)
    p95_idx = min(len(sorted_lat) - 1, int(len(sorted_lat) * 0.95))
    return {
        "indexVersion": index["indexVersion"],
        "documentCount": len(index["documents"]),
        "chunkCount": len(index["chunks"]),
        "totalCases": len(BENCHMARK_CASES),
        "positiveCases": positive_total,
        "negativeCases": negative_total,
        "metrics": {
            "recall_at_1": round(recall_at_1 / positive_total, 4),
            "recall_at_3": round(recall_at_3 / positive_total, 4),
            "mrr": round(mrr_sum / positive_total, 4),
            "negative_refusal_rate": round(negative_passed / negative_total, 4),
            "p50_latency_ms": round(statistics.median(sorted_lat), 3),
            "p95_latency_ms": round(sorted_lat[p95_idx], 3),
        },
        "details": details,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=str, default="")
    args = parser.parse_args()
    report = run_benchmark()
    summary = {k: v for k, v in report.items() if k != "details"}
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
