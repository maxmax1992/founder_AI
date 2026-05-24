#!/usr/bin/env python3
"""Build the app Graphify graph from local markdown brain data.

The runtime graph should come from Graphify artifacts, not from the legacy
graph.md files. This script creates a temporary markdown corpus that mirrors the
app brain layout while excluding graph.md, then runs the installed Graphify
module through the active Python interpreter.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CORPUS_DIR = ROOT / ".graphify-corpus"
GRAPHIFY_OUT = ROOT / "graphify-out"
GRAPHIFY_TMP_ROOT = ROOT / ".graphify-refresh-tmp"
GRAPHIFY_NEXT_OUT = ROOT / ".graphify-out-next"
GRAPHIFY_BACKUP_OUT = ROOT / ".graphify-out-backup"
TEXT_SUFFIXES = {".md", ".markdown", ".txt"}
DATE_HEADING_RE = re.compile(r"^\d{1,2} [A-Z][a-z]{2} \d{4}$")
CHUNK_CHAR_THRESHOLD = 120_000
CHUNK_TARGET_CHARS = 28_000
CHUNK_TARGET_NONEMPTY_LINES = 520


def copy_corpus() -> None:
    if CORPUS_DIR.exists():
        shutil.rmtree(CORPUS_DIR)
    CORPUS_DIR.mkdir(parents=True)

    if not DATA_DIR.exists():
        raise SystemExit("No data/ directory found. Start the app once before refreshing Graphify.")

    copied = 0
    source_files = 0
    chunked_sources = 0
    for source in DATA_DIR.rglob("*"):
        if not source.is_file():
            continue
        if source.name == "graph.md":
            continue
        if source.suffix.lower() not in TEXT_SUFFIXES:
            continue
        relative = source.relative_to(DATA_DIR)
        source_files += 1
        written = copy_or_chunk_source(source, relative)
        copied += written
        if written > 1:
            chunked_sources += 1

    if copied == 0:
        raise SystemExit("No markdown/text brain files found under data/.")
    print(
        f"Prepared {copied} Graphify corpus documents from {source_files} brain files"
        f" ({chunked_sources} oversized source file(s) chunked).",
        flush=True,
    )


def copy_or_chunk_source(source: Path, relative: Path) -> int:
    target = CORPUS_DIR / relative
    if not should_chunk_source(source, relative):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        return 1

    text = source.read_text(encoding="utf-8", errors="replace")
    chunk_bodies = chunk_markdown_source(text)
    chunk_dir = target.with_suffix("")
    chunk_dir.mkdir(parents=True, exist_ok=True)
    title = source_title(text, source.stem)
    total = len(chunk_bodies)
    for index, body in enumerate(chunk_bodies, start=1):
        chunk_path = chunk_dir / f"chunk-{index:03d}.md"
        chunk_path.write_text(
            "\n".join(
                [
                    f"# {title} - Part {index:02d}",
                    f"Original source: {relative.as_posix()}",
                    f"Chunk: {index} of {total}",
                    "",
                    body.strip(),
                    "",
                ]
            ),
            encoding="utf-8",
        )
    return total


def should_chunk_source(source: Path, relative: Path) -> bool:
    parts = relative.parts
    is_advisor_source = len(parts) >= 4 and parts[0] == "advisors" and parts[2] == "sources"
    return is_advisor_source and source.stat().st_size >= CHUNK_CHAR_THRESHOLD


def chunk_markdown_source(text: str) -> list[str]:
    lines = text.splitlines()
    first_dated_line = next((index for index, line in enumerate(lines) if DATE_HEADING_RE.match(line.strip())), -1)
    if first_dated_line == -1:
        return chunk_lines(lines)

    header = trim_sparse_lines(lines[:first_dated_line])
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines[first_dated_line:]:
        if DATE_HEADING_RE.match(line.strip()) and current:
            blocks.append(current)
            current = []
        current.append(line)
    if current:
        blocks.append(current)

    chunks: list[list[str]] = []
    current_chunk: list[str] = header[:]
    for block in blocks:
        if current_chunk and chunk_too_large(current_chunk, block):
            chunks.append(current_chunk)
            current_chunk = []
        current_chunk.extend(block)
    if current_chunk:
        chunks.append(current_chunk)
    return ["\n".join(trim_sparse_lines(chunk)) for chunk in chunks if trim_sparse_lines(chunk)]


def chunk_lines(lines: list[str]) -> list[str]:
    chunks: list[list[str]] = []
    current: list[str] = []
    for line in lines:
        if current and chunk_too_large(current, [line]):
            chunks.append(current)
            current = []
        current.append(line)
    if current:
        chunks.append(current)
    return ["\n".join(trim_sparse_lines(chunk)) for chunk in chunks if trim_sparse_lines(chunk)]


def chunk_too_large(current: list[str], incoming: list[str]) -> bool:
    combined = current + incoming
    return (
        sum(len(line) + 1 for line in combined) > CHUNK_TARGET_CHARS
        or sum(1 for line in combined if line.strip()) > CHUNK_TARGET_NONEMPTY_LINES
    )


def trim_sparse_lines(lines: list[str]) -> list[str]:
    trimmed: list[str] = []
    previous_blank = False
    for line in lines:
        blank = not line.strip()
        if blank and previous_blank:
            continue
        trimmed.append(line.rstrip())
        previous_blank = blank
    while trimmed and not trimmed[0].strip():
        trimmed.pop(0)
    while trimmed and not trimmed[-1].strip():
        trimmed.pop()
    return trimmed


def source_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or title_from_slug(fallback)
    return title_from_slug(fallback)


def title_from_slug(slug: str) -> str:
    return " ".join(part.capitalize() for part in re.split(r"[-_]+", slug) if part)


def run_graphify() -> None:
    reset_path(GRAPHIFY_TMP_ROOT)
    reset_path(GRAPHIFY_NEXT_OUT)
    reset_path(CORPUS_DIR / "graphify-out")

    subprocess.run(
        [sys.executable, "-m", "graphify", "extract", str(CORPUS_DIR), "--out", str(GRAPHIFY_TMP_ROOT)],
        check=True,
        cwd=ROOT,
    )
    generated_graph = GRAPHIFY_TMP_ROOT / "graphify-out" / "graph.json"
    if not generated_graph.exists():
        raise SystemExit("Graphify extraction did not produce graph.json; keeping previous graphify-out.")

    subprocess.run(
        [
            sys.executable,
            "-m",
            "graphify",
            "cluster-only",
            str(CORPUS_DIR),
            "--graph",
            str(generated_graph),
        ],
        check=True,
        cwd=ROOT,
    )

    shutil.copytree(GRAPHIFY_TMP_ROOT / "graphify-out", GRAPHIFY_NEXT_OUT)
    for artifact_name in ("GRAPH_REPORT.md", "graph.html"):
        generated = CORPUS_DIR / "graphify-out" / artifact_name
        if generated.exists():
            shutil.copy2(generated, GRAPHIFY_NEXT_OUT / artifact_name)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "graphify",
            "tree",
            "--graph",
            str(GRAPHIFY_NEXT_OUT / "graph.json"),
            "--output",
            str(GRAPHIFY_NEXT_OUT / "GRAPH_TREE.html"),
            "--root",
            str(CORPUS_DIR),
            "--label",
            "Founder's harness",
        ],
        check=True,
        cwd=ROOT,
    )
    replace_graphify_out()


def reset_path(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)


def replace_graphify_out() -> None:
    reset_path(GRAPHIFY_BACKUP_OUT)
    if GRAPHIFY_OUT.exists():
        GRAPHIFY_OUT.rename(GRAPHIFY_BACKUP_OUT)
    try:
        GRAPHIFY_NEXT_OUT.rename(GRAPHIFY_OUT)
    except Exception:
        if GRAPHIFY_BACKUP_OUT.exists() and not GRAPHIFY_OUT.exists():
            GRAPHIFY_BACKUP_OUT.rename(GRAPHIFY_OUT)
        raise
    reset_path(GRAPHIFY_BACKUP_OUT)
    reset_path(GRAPHIFY_TMP_ROOT)


def main() -> None:
    copy_corpus()
    run_graphify()
    print("Graphify refresh complete: graphify-out/graph.json and GRAPH_TREE.html")


if __name__ == "__main__":
    main()
