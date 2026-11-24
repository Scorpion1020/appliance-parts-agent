"""小型本地向量索引；显式构建时下载模型，查询期间禁止自动下载。"""

import argparse
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.shared.errors import AgentToolError

MODEL = "BAAI/bge-small-en-v1.5"
ROOT = Path(__file__).resolve().parents[2] / "data"


def vector_path() -> Path:
    return Path(os.environ.get("SHOPPING_AGENT_VECTOR_INDEX", str(ROOT / "knowledge-vectors.npz")))


@lru_cache(maxsize=2)
def embedding_model(download: bool = False):
    from fastembed import TextEmbedding
    return TextEmbedding(model_name=MODEL, cache_dir=str(ROOT / "embedding-cache"),
                         threads=2, local_files_only=not download)


def normalize(values):
    import numpy as np
    matrix = np.asarray(values, dtype=np.float32)
    lengths = np.linalg.norm(matrix, axis=-1, keepdims=True)
    if not np.isfinite(matrix).all() or (lengths <= 0).any():
        raise ValueError("Invalid embeddings")
    return matrix / lengths


def build_vectors() -> dict:
    import numpy as np
    from app.agent.knowledge import load_index
    index = load_index()
    documents = {doc["id"]: doc for doc in index["documents"]}
    texts = [documents[chunk["documentId"]]["title"] + "\n" + chunk["heading"] + "\n" + chunk["text"] for chunk in index["chunks"]]
    matrix = normalize(list(embedding_model(True).passage_embed(texts)))
    target = vector_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    metadata = {"model": MODEL, "indexVersion": index["indexVersion"], "chunkIds": [chunk["id"] for chunk in index["chunks"]]}
    with NamedTemporaryFile(dir=target.parent, suffix=".npz", delete=False) as temporary:
        np.savez_compressed(temporary, vectors=matrix, metadata=json.dumps(metadata))
        staging = Path(temporary.name)
    staging.replace(target)
    return {"chunks": len(matrix), "dimensions": matrix.shape[1], "model": MODEL, "indexVersion": index["indexVersion"]}


def hybrid_search(index: dict, query: str, appliance: str | None = None) -> dict:
    from app.agent.knowledge import search_index, tokenize
    lexical = search_index(index, query, appliance)
    base = {**lexical, "method": "hybrid", "embeddingModel": MODEL}
    if lexical["status"] == "insufficient_query":
        return base
    try:
        import numpy as np
        with np.load(vector_path(), allow_pickle=False) as artifact:
            metadata = json.loads(str(artifact["metadata"]))
            matrix = artifact["vectors"]
        if metadata != {"model": MODEL, "indexVersion": index["indexVersion"], "chunkIds": [chunk["id"] for chunk in index["chunks"]]}:
            raise ValueError("Stale vector index")
        query_vector = normalize(list(embedding_model().query_embed([query])))[0]
        if matrix.shape != (len(index["chunks"]), len(query_vector)) or not np.isfinite(matrix).all():
            raise ValueError("Invalid vector index")
        similarities = matrix @ query_vector
    except (ImportError, OSError, ValueError, RuntimeError, KeyError):
        raise AgentToolError("vector_index_unavailable", "Local vector resources are missing or stale. Build them explicitly or configure bm25; no automatic download or silent fallback occurred.", 503) from None
    documents = {doc["id"]: doc for doc in index["documents"]}
    identifiers = [term for term in tokenize(query) if re.search(r"[a-z]", term) and re.search(r"\d", term)]
    brands = [brand for brand in ("Whirlpool", "GE") if re.search(r"\b" + brand + r"\b", query, re.I)]
    candidates = []
    for position, chunk in enumerate(index["chunks"]):
        doc = documents[chunk["documentId"]]
        if appliance and doc["applianceType"] != appliance or brands and doc["brand"] not in brands:
            continue
        if any(not chunk["terms"].get(term, 0) for term in identifiers):
            continue
        # 固定门槛只用于这份小型英文资料集，不解释为置信度。
        if similarities[position] >= 0.65:
            candidates.append((float(similarities[position]), chunk))
    candidates.sort(key=lambda item: (-item[0], item[1]["id"]))
    hits = {hit["chunkId"]: dict(hit) for hit in lexical["hits"]}
    scores = {hit["chunkId"]: 1 / (60 + rank) for rank, hit in enumerate(lexical["hits"], 1)}
    for rank, (_, chunk) in enumerate(candidates[:3], 1):
        doc = documents[chunk["documentId"]]
        scores[chunk["id"]] = scores.get(chunk["id"], 0) + 1 / (60 + rank)
        if chunk["id"] not in hits:
            hits[chunk["id"]] = {"chunkId": chunk["id"], "documentId": doc["id"], "documentVersion": chunk["documentVersion"],
                "title": doc["title"], "heading": chunk["heading"], "summary": chunk["text"], "sourceUrl": doc["url"],
                "reviewedAt": doc["reviewedAt"], "sourceKind": doc["sourceKind"], "scope": doc["scope"], "safety": doc["safety"]}
    ranked = sorted(hits, key=lambda key: (-scores[key], key))[:3]
    return {**base, "status": "found" if ranked else "no_evidence", "hits": [{**hits[key], "score": round(scores[key], 6)} for key in ranked]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Explicitly download the local embedding model and build the reviewed knowledge vector index.")
    parser.add_argument("--build", action="store_true", required=True)
    parser.parse_args()
    print(json.dumps(build_vectors()))
