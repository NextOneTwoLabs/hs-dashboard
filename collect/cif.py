"""Parsers for cifstate.org (PrestoSports) bracket pages.

The CIF site only gives us the list of divisions for a competition and, on
each division page, the embedded MaxPreps bracket widget link. All game data
comes from MaxPreps (see maxpreps.py).
"""
import re
from urllib.parse import urljoin

from . import dom

_DIV_SLUG = re.compile(r"^(b|boys|g|girls)[-_]?(?:d|div|division)?[-_]?([1-9])$", re.I)


def division_code(slug):
    """'bd1' / 'boysd1' / 'GD3' -> 'bd1' / 'bd1' / 'gd3'; None if not a division."""
    m = _DIV_SLUG.match(slug.strip())
    if not m:
        return None
    return ("b" if m.group(1).lower().startswith("b") else "g") + "d" + m.group(2)


def division_label(code):
    gender = "Boys" if code[0] == "b" else "Girls"
    return f"{gender} Division {code[2:]}"


def parse_index(html, path, base):
    """Return {code: url} for every division linked from a competition index."""
    root = dom.parse(html)
    found = {}
    prefix = f"/{path}/"
    for a in root.find_all("a"):
        href = (a.get("href") or "").strip()
        i = href.find(prefix)
        if i < 0:
            continue
        slug = href[i + len(prefix):].split("?")[0].split("#")[0].strip("/")
        code = division_code(slug) if "/" not in slug else None
        if code and code not in found:
            found[code] = urljoin(base, f"{path}/{slug}")
    return dict(sorted(found.items()))


def parse_division(html):
    """Return the MaxPreps bracket URL embedded in a division page, or None."""
    root = dom.parse(html)
    a = root.find("a", cls="maxpreps-widget-link")
    if a is None:
        return None
    href = (a.get("href") or "").strip()
    return href or None
