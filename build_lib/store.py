"""Paths and file I/O shared by the crawler.

Derived files are written with one list row per line so that git diffs stay
small and reviewable, and only when their content actually changed.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SOURCES = PUBLIC / "data" / "sources.json"
ALIASES = PUBLIC / "data" / "school-aliases.json"
ARCHIVE = PUBLIC / "archive"          # served through /api/v1
RAW = ROOT / "archive" / "raw"        # provenance, never served
LINKS = ROOT / "archive" / "links.json"
EXPORT = ROOT / "export"


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def _compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def dumps(obj):
    """Pretty-print top-level keys; lists of objects get one item per line."""
    if not isinstance(obj, dict):
        return _compact(obj) + "\n"
    lines = []
    for key, value in obj.items():
        head = f"  {_compact(key)}: "
        if isinstance(value, list) and value and all(isinstance(v, dict) for v in value):
            rows = ",\n".join("    " + _compact(v) for v in value)
            lines.append(head + "[\n" + rows + "\n  ]")
        elif isinstance(value, dict) and value and all(isinstance(v, dict) for v in value.values()):
            rows = ",\n".join(f"    {_compact(k)}: {_compact(v)}" for k, v in value.items())
            lines.append(head + "{\n" + rows + "\n  }")
        else:
            lines.append(head + _compact(value))
    return "{\n" + ",\n".join(lines) + "\n}\n"


def write_text(path, text):
    """Atomic write; returns True if the file changed."""
    path = Path(path)
    try:
        if path.read_text(encoding="utf-8") == text:
            return False
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)
    return True


def write_json(path, obj):
    return write_text(path, dumps(obj))


def season_end_year(season):
    return int(season[:4]) + 1
