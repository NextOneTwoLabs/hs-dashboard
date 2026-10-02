"""A tiny DOM tree on top of html.parser, so parsers can select by tag/class
without third-party dependencies."""
from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs or {})
        self.children = []
        self.parent = parent

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()

    def get(self, name, default=None):
        value = self.attrs.get(name)
        return default if value is None else value

    def text(self):
        out = []
        for child in self.children:
            out.append(child if isinstance(child, str) else child.text())
        return " ".join("".join(out).split())

    def iter(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.iter()

    def find_all(self, tag=None, cls=None, **attrs):
        for node in self.iter():
            if tag and node.tag != tag:
                continue
            if cls and cls not in node.classes:
                continue
            if any(node.attrs.get(k) != v for k, v in attrs.items()):
                continue
            yield node

    def find(self, tag=None, cls=None, **attrs):
        return next(self.find_all(tag, cls, **attrs), None)


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        node = self.cur
        while node is not self.root and node.tag != tag:
            node = node.parent
        if node is not self.root:
            self.cur = node.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(html):
    builder = _Builder()
    builder.feed(html)
    builder.close()
    return builder.root
