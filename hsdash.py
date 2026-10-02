"""hs-dashboard command line (#8 PR 3, after collegedash's).

  python hsdash.py refresh [--export] [--today D] [--now T] [--state ST] [--max-requests N] [--force]
                                          crawl competitions that are live today (no-op otherwise)
  python hsdash.py backfill [--export] [--state ST] [--max-requests N] [--force]
                                          crawl every registry season not yet complete
  python hsdash.py season 2025-26 [--state TX] [--export] [--force]
                                          crawl one season
  python hsdash.py discover 2026-27 [--max-requests N]
                                          list MaxPreps tournaments for review
  python hsdash.py build [--check] [--export]
                                          rebuild public/archive (and export/) from archive/raw, offline;
                                          --check fails if the committed files are stale (CI)
  python hsdash.py validate [--fresh | --archive DIR]
                                          check the published files against schema/*.schema.json, plus
                                          cross-checks (#8 PR 4); --fresh validates a build written to a temp
                                          directory. Needs requirements-dev.txt (jsonschema), unlike the rest
  python hsdash.py serve [--port 8787]    the local offline server (dev_server.py)

Every crawl ends with a build, as before. The old `python -m crawler.hs --…` commands still work through a
shim until #8's last PR; both run the same engine (collect/refresh.py).
"""
import argparse
import sys


def legacy_argv(args):
    """The engine's flags (collect.refresh.main) for a subcommand."""
    out = []
    if args.cmd in ("refresh", "backfill"):
        out.append(f"--{args.cmd}")
    elif args.cmd == "season":
        out += ["--season", args.season]
    elif args.cmd == "discover":
        out += ["--discover", args.season]
    elif args.cmd == "build":
        out.append("--derive")
    for flag in ("state", "today", "now", "max_requests"):
        value = getattr(args, flag, None)
        if value is not None:
            out += [f"--{flag.replace('_', '-')}", str(value)]
    for flag in ("force", "check", "export"):
        if getattr(args, flag, False):
            out.append(f"--{flag}")
    return out


def parser():
    p = argparse.ArgumentParser(prog="hsdash.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, helptext in (("refresh", "crawl competitions that are live today"),
                           ("backfill", "crawl every registry season not yet complete")):
        c = sub.add_parser(name, help=helptext)
        c.add_argument("--state")
        c.add_argument("--max-requests", type=int)
        c.add_argument("--force", action="store_true")
        c.add_argument("--export", action="store_true")
        if name == "refresh":
            c.add_argument("--today", help="override today's date (YYYY-MM-DD)")
            c.add_argument("--now", help="override the run's start time (ISO, UTC), e.g. 2027-04-20T06:00Z")
    c = sub.add_parser("season", help="crawl one season")
    c.add_argument("season")
    c.add_argument("--state")
    c.add_argument("--max-requests", type=int)
    c.add_argument("--force", action="store_true")
    c.add_argument("--export", action="store_true")
    c = sub.add_parser("discover", help="list MaxPreps tournaments for a season, for review")
    c.add_argument("season")
    c.add_argument("--max-requests", type=int)
    c = sub.add_parser("build", help="rebuild public/archive from archive/raw (offline)")
    c.add_argument("--check", action="store_true", help="fail if the committed files are stale")
    c.add_argument("--export", action="store_true", help="also write the CSV exports")
    c = sub.add_parser("validate", help="check the published files against their schemas, plus cross-checks")
    where = c.add_mutually_exclusive_group()
    where.add_argument("--fresh", action="store_true", help="validate a build written to a temp directory")
    where.add_argument("--archive", help="validate this directory instead of public/archive")
    c = sub.add_parser("serve", help="the local offline server")
    c.add_argument("--port", type=int, default=8787)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    if args.cmd == "serve":
        import dev_server
        return dev_server.main(["--port", str(args.port)])
    if args.cmd == "validate":
        from build_lib import validate
        return validate.main(["--fresh"] if args.fresh else ["--archive", args.archive] if args.archive else [])
    from collect.refresh import main as engine
    return engine(legacy_argv(args))


if __name__ == "__main__":
    sys.exit(main())
