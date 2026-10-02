"""Division labels, codes and ordering for state brackets.

States name their brackets very differently ("2026 Soccer Conference 6A D1",
"Class 7A Tournament", "1B/2B", "Division 1"), so a division is a free-form
slug plus a cleaned label and a sort key (largest class first, then D1, D2).
"""
import re

_NOISE = re.compile(r"\b(?:girls'?|women'?s|soccer|playoffs?|tournament|state|championships?|brackets?)\b", re.I)
_YEAR = re.compile(r"^\s*\d{4}(?:-\d{2,4})?\s+")
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


def clean_label(name, drop=()):
    """Strip years, filler words and the association's own acronym."""
    label = _NOISE.sub(" ", _YEAR.sub("", name or ""))
    for word in drop:
        label = re.sub(r"\b" + re.escape(word) + r"\b", " ", label, flags=re.I)
    label = " ".join(label.replace("( )", " ").split()).strip(" -–:")
    return label or (name or "").strip()


def code_for(label):
    """'Conference 6A D1' -> '6a-d1'; 'Class 7A' -> '7a'; '1B/2B' -> '1b-2b'."""
    text = re.sub(r"^(?:conference|class)\s+", "", label.strip(), flags=re.I)
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:30].strip("-") or "main"


def _num(token):
    return int(token) if token.isdigit() else _ROMAN.get(token.upper())


def order_key(label):
    """Larger classes first (7A before 1A, 'AAAA' before 'A', A before B,
    '1A-3A' ranks as 3A), then divisions ascending (D1 before D2)."""
    up = label.upper()
    size = None
    classes = re.findall(r"(\d)\s*([AB])\b", up)
    if classes:
        size = max(int(n) + (10 if letter == "A" else 0) for n, letter in classes)
    else:
        m = re.search(r"\b(A{1,7})\b", up)
        if m:
            size = 10 + len(m.group(1))
    div = None
    m = re.search(r"\b(?:D|DIV|DIVISION)\.?\s*([IVX]+|\d+)\b", up)
    if m:
        div = _num(m.group(1))
    elif size is None:
        m = re.search(r"\bCLASS\s+([IVX]+)\b", up)
        if m:
            size = 10 - (_num(m.group(1)) or 0)
    return (-(size or 0), div or 0, label)


def cif_division(code):
    """CIF codes 'gd3' / 'bd1' -> (gender, label)."""
    return ("boys" if code[0] == "b" else "girls"), f"Division {code[2:]}"
