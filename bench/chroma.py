"""The Chroma side of the comparison.

Reads a corpus and the same twenty questions the TypeScript harness asks, indexes
it twice -- one vector per concept, and again in overlapping character chunks --
and reports what each query returns. Token math stays in TypeScript, so this
returns character counts and the keys they belong to rather than bills.

Run through `bun bench/chroma.ts`; it is invoked as
`uv run --with chromadb python bench/chroma.py <input.json> <output.json>`.
"""

import json
import os
import resource
import shutil
import sys
import tempfile
import time
from statistics import median

import chromadb
from chromadb.config import Settings

MAX_BATCH = 500


def rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    scale = 1 << 20 if sys.platform == "darwin" else 1 << 10

    return peak / scale


def dir_mb(path: str) -> float:
    total = 0

    for root, _, files in os.walk(path):
        for name in files:
            total += os.path.getsize(os.path.join(root, name))

    return total / (1 << 20)


def embedded(concept: dict) -> str:
    """Titles are indexed because langonrock indexes them, weighted above the
    body. Withholding them here would reproduce the bug the store already fixed
    rather than measure Chroma."""
    title = concept.get("title") or ""

    return f"{title}\n\n{concept['body']}" if title else concept["body"]


def row(concept: dict) -> str:
    """One search result line, shaped like the manifest row langonrock ranks
    with, so a metadata-only Chroma result carries the same information."""
    return f"{concept['id']}\t{concept.get('title') or ''}\t{concept.get('summary') or ''}"


def chunks(text: str, size: int, overlap: int) -> list[str]:
    if len(text) <= size:
        return [text]

    out = []
    start = 0

    while start < len(text):
        end = min(start + size, len(text))

        if end < len(text):
            border = text.rfind(" ", start + size - overlap, end)

            if border > start:
                end = border

        piece = text[start:end].strip()

        if piece:
            out.append(piece)

        if end >= len(text):
            break

        start = max(end - overlap, start + 1)

    return out


def units(concepts: list[dict], size: int, overlap: int) -> list[dict]:
    """Doc grain is one unit per concept; chunk grain splits the same text. Both
    carry the concept id so a ranked list can be scored against the same ground
    truth the other harness uses."""
    if size == 0:
        return [
            {"key": c["id"], "concept": c["id"], "text": embedded(c), "row": row(c)}
            for c in concepts
        ]

    out = []

    for concept in concepts:
        for index, piece in enumerate(chunks(embedded(concept), size, overlap)):
            out.append(
                {
                    "key": f"{concept['id']}#{index}",
                    "concept": concept["id"],
                    "text": piece,
                    "row": row(concept),
                }
            )

    return out


def build(path: str, name: str, items: list[dict]) -> tuple:
    client = chromadb.PersistentClient(
        path=path, settings=Settings(anonymized_telemetry=False)
    )
    collection = client.create_collection(name)
    start = time.perf_counter()

    for offset in range(0, len(items), MAX_BATCH):
        batch = items[offset : offset + MAX_BATCH]

        collection.add(
            ids=[item["key"] for item in batch],
            documents=[item["text"] for item in batch],
            metadatas=[{"concept": item["concept"]} for item in batch],
        )

    return collection, (time.perf_counter() - start) * 1000


def ask(collection, rows: dict, queries: list[str], k: int) -> tuple:
    """Every result the query returns, in rank order, with the size of the
    document and of its metadata row. Billing chooses between them."""
    results = []
    timings = []

    for query in queries:
        start = time.perf_counter()
        found = collection.query(
            query_texts=[query], n_results=k, include=["documents", "metadatas"]
        )
        timings.append((time.perf_counter() - start) * 1000)

        hits = []

        for key, text, meta in zip(
            found["ids"][0], found["documents"][0], found["metadatas"][0]
        ):
            concept = meta["concept"]

            hits.append(
                {
                    "key": key,
                    "concept": concept,
                    "chars": len(text),
                    "metaChars": len(rows.get(concept, "")),
                }
            )

        results.append(hits)

    return results, timings


def side(root: str, name: str, payload: dict, items: list[dict]) -> dict:
    path = os.path.join(root, name)
    collection, build_ms = build(path, name, items)
    rows = {c["id"]: row(c) for c in payload["concepts"]}
    k = payload["k"]
    named, named_ms = ask(
        collection, rows, [q["named"] for q in payload["questions"]], k
    )
    described, described_ms = ask(
        collection, rows, [q["described"] for q in payload["questions"]], k
    )

    return {
        "count": len(items),
        "buildMs": build_ms,
        "queryMs": median(named_ms + described_ms),
        "diskMb": dir_mb(path),
        "named": named,
        "described": described,
    }


def main() -> None:
    with open(sys.argv[1]) as handle:
        payload = json.load(handle)

    root = tempfile.mkdtemp(prefix="langonrock-chroma-")

    try:
        doc = side(root, "doc_grain", payload, units(payload["concepts"], 0, 0))
        chunk = side(
            root,
            "chunk_grain",
            payload,
            units(
                payload["concepts"], payload["chunkChars"], payload["chunkOverlap"]
            ),
        )
    finally:
        shutil.rmtree(root, ignore_errors=True)

    with open(sys.argv[2], "w") as handle:
        json.dump(
            {
                "chromaVersion": chromadb.__version__,
                "doc": doc,
                "chunk": chunk,
                "rssMb": rss_mb(),
            },
            handle,
        )


main()
