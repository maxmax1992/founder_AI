#!/usr/bin/env python3
"""Manage LLM Wiki sources for the Sprint Buddy knowledge base."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
SOURCES_DIR = ROOT / "sources"
ACTIVE_DIR = SOURCES_DIR / "active"
ARCHIVE_DIR = SOURCES_DIR / "archive"
REGISTRY_PATH = SOURCES_DIR / "sources.json"

VALID_STATUSES = {"active", "draft", "removed"}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return re.sub(r"-+", "-", slug) or "source"


def default_source_id(title: str) -> str:
    return f"{dt.date.today().strftime('%Y%m%d')}-{slugify(title)}"


def is_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def repo_relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def ensure_layout() -> None:
    for path in (ACTIVE_DIR, ARCHIVE_DIR, SOURCES_DIR / "inbox", SOURCES_DIR / "assets"):
        path.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_PATH.exists():
        REGISTRY_PATH.write_text(json.dumps({"version": 1, "sources": []}, indent=2) + "\n")


def load_registry() -> dict:
    ensure_layout()
    return json.loads(REGISTRY_PATH.read_text())


def save_registry(registry: dict) -> None:
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n")


def find_source(registry: dict, source_id: str) -> dict:
    for source in registry["sources"]:
        if source["id"] == source_id:
            return source
    raise SystemExit(f"Unknown source id: {source_id}")


def unique_source_id(registry: dict, requested: str) -> str:
    existing = {source["id"] for source in registry["sources"]}
    if requested not in existing:
        return requested
    index = 2
    while f"{requested}-{index}" in existing:
        index += 1
    return f"{requested}-{index}"


def parse_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [tag.strip() for tag in raw.split(",") if tag.strip()]


def copy_input_to_active(source_input: str, source_id: str) -> str:
    target_dir = ACTIVE_DIR / source_id
    target_dir.mkdir(parents=True, exist_ok=False)

    if is_url(source_input):
        stub_path = target_dir / "source.md"
        stub_path.write_text(
            f"# URL Source\n\nSource URL: {source_input}\n\n"
            "Fetch or clip this source into this folder before relying on it for advisor answers.\n"
        )
        return repo_relative(stub_path)

    input_path = Path(source_input).expanduser()
    if not input_path.is_absolute():
        input_path = (ROOT / input_path).resolve()
    if not input_path.exists():
        raise SystemExit(f"Source path does not exist: {input_path}")

    if input_path.is_dir():
        destination = target_dir / input_path.name
        shutil.copytree(input_path, destination)
        return repo_relative(destination)

    destination = target_dir / input_path.name
    shutil.copy2(input_path, destination)
    return repo_relative(destination)


def cmd_add(args: argparse.Namespace) -> None:
    registry = load_registry()
    source_id = unique_source_id(registry, args.id or default_source_id(args.title))
    path = copy_input_to_active(args.input, source_id)
    timestamp = now_iso()
    source = {
        "id": source_id,
        "title": args.title,
        "kind": args.kind,
        "status": args.status,
        "advisor": args.advisor,
        "tags": parse_tags(args.tags),
        "path": path,
        "origin": args.input,
        "notes": args.notes or "",
        "added_at": timestamp,
        "updated_at": timestamp,
    }
    registry["sources"].append(source)
    save_registry(registry)
    print(f"Added {source_id}")
    print(f"Path: {path}")


def cmd_list(args: argparse.Namespace) -> None:
    registry = load_registry()
    sources = registry["sources"]
    if args.status:
        sources = [source for source in sources if source["status"] == args.status]
    if not sources:
        print("No sources found.")
        return
    for source in sources:
        tags = ",".join(source.get("tags", [])) or "-"
        print(f"{source['id']} | {source['status']} | {source['title']} | {tags}")
        print(f"  {source['path']}")


def cmd_edit(args: argparse.Namespace) -> None:
    registry = load_registry()
    source = find_source(registry, args.source_id)
    if args.title is not None:
        source["title"] = args.title
    if args.kind is not None:
        source["kind"] = args.kind
    if args.status is not None:
        source["status"] = args.status
    if args.advisor is not None:
        source["advisor"] = args.advisor
    if args.tags is not None:
        source["tags"] = parse_tags(args.tags)
    if args.notes is not None:
        source["notes"] = args.notes
    source["updated_at"] = now_iso()
    save_registry(registry)
    print(f"Updated {source['id']}")


def move_source_path(source: dict, target_root: Path) -> str:
    current = ROOT / source["path"]
    if not current.exists():
        return source["path"]
    target = target_root / source["id"] / current.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise SystemExit(f"Target already exists: {target}")
    shutil.move(str(current), str(target))
    return repo_relative(target)


def cmd_remove(args: argparse.Namespace) -> None:
    registry = load_registry()
    source = find_source(registry, args.source_id)
    if not args.keep_files:
        source["path"] = move_source_path(source, ARCHIVE_DIR)
    source["status"] = "removed"
    source["updated_at"] = now_iso()
    save_registry(registry)
    print(f"Removed {source['id']}")


def cmd_restore(args: argparse.Namespace) -> None:
    registry = load_registry()
    source = find_source(registry, args.source_id)
    source["path"] = move_source_path(source, ACTIVE_DIR)
    source["status"] = "active"
    source["updated_at"] = now_iso()
    save_registry(registry)
    print(f"Restored {source['id']}")


def cmd_active_paths(args: argparse.Namespace) -> None:
    registry = load_registry()
    for source in registry["sources"]:
        if source["status"] == "active":
            print(source["path"])


def cmd_graphify_command(args: argparse.Namespace) -> None:
    print("graphify sources/active --update --wiki --obsidian --obsidian-dir wiki")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    add = subparsers.add_parser("add", help="add a source to sources/active and the registry")
    add.add_argument("input", help="local file, local directory, or URL")
    add.add_argument("--title", required=True)
    add.add_argument("--id")
    add.add_argument("--kind", default="document")
    add.add_argument("--status", choices=sorted(VALID_STATUSES), default="active")
    add.add_argument("--advisor", default="marten")
    add.add_argument("--tags", help="comma-separated tags")
    add.add_argument("--notes")
    add.set_defaults(func=cmd_add)

    list_cmd = subparsers.add_parser("list", help="list registered sources")
    list_cmd.add_argument("--status", choices=sorted(VALID_STATUSES))
    list_cmd.set_defaults(func=cmd_list)

    edit = subparsers.add_parser("edit", help="edit source metadata")
    edit.add_argument("source_id")
    edit.add_argument("--title")
    edit.add_argument("--kind")
    edit.add_argument("--status", choices=sorted(VALID_STATUSES))
    edit.add_argument("--advisor")
    edit.add_argument("--tags", help="replace tags with this comma-separated list")
    edit.add_argument("--notes")
    edit.set_defaults(func=cmd_edit)

    remove = subparsers.add_parser("remove", help="mark a source removed and archive its files")
    remove.add_argument("source_id")
    remove.add_argument("--keep-files", action="store_true", help="do not move files to sources/archive")
    remove.set_defaults(func=cmd_remove)

    restore = subparsers.add_parser("restore", help="restore a removed source to active")
    restore.add_argument("source_id")
    restore.set_defaults(func=cmd_restore)

    active_paths = subparsers.add_parser("active-paths", help="print active source paths")
    active_paths.set_defaults(func=cmd_active_paths)

    graphify_command = subparsers.add_parser("graphify-command", help="print the graphify refresh command")
    graphify_command.set_defaults(func=cmd_graphify_command)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

