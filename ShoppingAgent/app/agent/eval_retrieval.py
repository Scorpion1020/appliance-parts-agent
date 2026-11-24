"""固定小型留出问法对比，不据此宣称一般用户成功率。"""

import json
import time
import argparse
from pathlib import Path

from app.agent.knowledge import load_index, search_index
from app.agent.vector_search import hybrid_search

CASES = [
    ("GE dishwasher illuminated control panel refuses to begin a cycle", "ge-dishwasher-start"),
    ("GE refrigerator groceries are warmer than expected", "ge-refrigerator-cooling"),
    ("GE freezer door stays ajar instead of sealing", "ge-refrigerator-door"),
    ("GE fridge makes a humming or clicking sound", "ge-refrigerator-noise"),
    ("GE dishwasher water remains after replacing the garbage disposer", "ge-dishwasher-drain"),
    ("Whirlpool dishwasher how to wash the removable screen", "whirlpool-dishwasher-filter"),
    ("Whirlpool refrigerator dust around the condenser", "whirlpool-refrigerator-coils"),
    ("PS99999999 compatibility", None),
    ("quantum entanglement", None),
    ("cryptocurrency trading signals", None),
    ("dishwasher", None),
]

CLOSEOUT_CASES = [
    ("GE dishwasher lights on but cycle will not start", "ge-dishwasher-start"),
    ("GE dishwasher control lock prevents starting", "ge-dishwasher-start"),
    ("GE refrigerator warm food temperature settings", "ge-refrigerator-cooling"),
    ("GE refrigerator insufficient cooling after installation", "ge-refrigerator-cooling"),
    ("GE refrigerator door blocked by food packages", "ge-refrigerator-door"),
    ("GE freezer door gasket prevents closing", "ge-refrigerator-door"),
    ("GE refrigerator buzzing noise normal operation", "ge-refrigerator-noise"),
    ("GE refrigerator clicking sounds during operation", "ge-refrigerator-noise"),
    ("GE dishwasher standing water drain hose", "ge-dishwasher-drain"),
    ("GE dishwasher garbage disposal drain connection", "ge-dishwasher-drain"),
    ("Whirlpool dishwasher removable filter cleaning", "whirlpool-dishwasher-filter"),
    ("Whirlpool dishwasher different filter types", "whirlpool-dishwasher-filter"),
    ("Whirlpool refrigerator condenser cleaning safety", "whirlpool-refrigerator-coils"),
    ("Whirlpool refrigerator condenser requires technician", "whirlpool-refrigerator-coils"),
    ("GE dishwasher ZZZ99999999 drain instructions", None),
    ("Whirlpool refrigerator PS99999999 fit", None),
    ("GE refrigerator WPW10448645 compatibility", None),
    ("Whirlpool dishwasher", None),
    ("stock market forecast", None),
    ("", None),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["original", "closeout"], default="original")
    parser.add_argument("--method", choices=["both", "bm25"], default="both")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    index = load_index()
    rows = []
    methods = (("bm25", search_index),) if args.method == "bm25" else (("bm25", search_index), ("hybrid", hybrid_search))
    for query, expected in CLOSEOUT_CASES if args.suite == "closeout" else CASES:
        row = {"query": query, "expectedDocument": expected}
        appliance = "dishwasher" if "dishwasher" in query.lower() else "refrigerator" if any(term in query.lower() for term in ("refrigerator", "fridge")) else None
        for name, search in methods:
            started = time.monotonic()
            result = search(index, query, appliance)
            documents = [hit["documentId"] for hit in result["hits"]]
            row[name] = {"status": result["status"], "documents": documents,
                "passed": documents[0] == expected if expected and documents else not documents if expected is None else False,
                "elapsedMs": round((time.monotonic() - started) * 1000)}
        rows.append(row)
    report = {"scope": "Self-authored acceptance questions, not independent human review or a population estimate. First hybrid query includes local model loading.",
        "suite": args.suite,
        "indexVersion": index["indexVersion"], "total": len(rows),
        "passed": {name: sum(row[name]["passed"] for row in rows) for name, _ in methods}, "rows": rows}
    serialized = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
