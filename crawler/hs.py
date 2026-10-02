"""Deprecated shim (#8 PR 3): the crawler moved to collect/ and build.py, and the CLI is `python hsdash.py`.

`python -m crawler.hs --refresh/--backfill/--season/--discover/--derive/--check/--export` keeps working by passing
its flags straight to the same engine (collect.refresh.main), so old commands, notes and bookmarks don't break.
tests/test_cli.py checks that this shim and `python hsdash.py build` give byte-identical output. It goes in #8's
last PR.
"""
import sys

from collect.refresh import main

if __name__ == "__main__":
    sys.exit(main())
