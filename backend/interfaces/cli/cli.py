"""Command line for niche-finder -- to check and try everything
without connecting to Claude Desktop.

    python cli.py doctor                      check the key, network, database
    python cli.py collect-channel @handle     collect a channel (cheap)
    python cli.py collect "ai automation" --period 24h   [--no-embed]
    python cli.py refresh                     refresh counters (history)
    python cli.py embed-videos                compute missing embeddings (0 quota)
    python cli.py fix-tracked [--apply]       clean the watchlist of handles/urls instead of ids
    python cli.py viral --period 24h
    python cli.py categories --period 7d --rank-by channels
    python cli.py keywords --period 24h
    python cli.py channels --period 24h       outlier channels
    python cli.py stats
    python cli.py notify-test                 test message to Telegram/webhook
    python cli.py digest-send                 send the 24-hour digest right now
    python cli.py export-niche my-niche --format csv --out out.csv
    python cli.py seed                        synthetic example data

In Docker:  docker compose run --rm mcp python cli.py doctor
"""
import argparse
import json
import os
import sys

import infrastructure.postgres as db


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))
    # An empty result almost always means "the default threshold", not
    # "nothing found" -- we surface the hint at the top, to stderr.
    if isinstance(obj, dict) and obj.get("hint"):
        print(f"\n>>> {obj['hint']}", file=sys.stderr)


def _key():
    from dotenv import load_dotenv
    load_dotenv()
    return os.environ.get("YOUTUBE_API_KEY", "").strip()


def _ping_llm(problems):
    """Shared by doctor's openrouter/ollama branches -- one real llm_gateway
    call, spending a little budget (openrouter) or a few local CPU/GPU
    seconds (ollama)."""
    from application import llm_gateway
    ping_schema = {"type": "object", "properties": {"ok": {"type": "boolean"}},
                   "required": ["ok"]}
    data = llm_gateway.run("doctor_ping", "Reply with JSON only.",
                           "Return {\"ok\": true}.", ping_schema)
    if data == {"ok": True}:
        print("   OK -- the provider responded")
    else:
        print("   ERROR or budget exhausted -- see the log above")
        problems.append("The LLM provider ping failed -- check the key/model/URL "
                        "and LLM_DAILY_BUDGET_USD")


def cmd_doctor(args):
    """Everything that can go wrong, in order -- and what exactly to do."""
    from application import discovery as trends
    from application import search as query
    problems = []
    key = _key()

    print("1. Key")
    if not key:
        print("   MISSING")
        problems.append("Put YOUTUBE_API_KEY in .env next to docker-compose.yml")
    elif not key.startswith("AIza") or len(key) < 35:
        print(f"   suspicious shape: length {len(key)}, starts with {key[:4]!r}")
        problems.append("A Google key is usually 39 characters and starts with AIza -- "
                        "it looks like it was not copied in full")
    else:
        print(f"   present, length {len(key)}, starts with {key[:4]}…")

    print("2. Network and the key itself")
    if key:
        import infrastructure.youtube.client as yt
        try:
            cats = yt.video_categories(key, region_code="US")
            print(f"   OK -- the API responded, {len(cats)} categories (1 unit spent)")
        except Exception as e:
            msg = str(e).replace(key, "<KEY>")
            print(f"   ERROR: {msg[:400]}")
            if "accessNotConfigured" in msg or "has not been used" in msg:
                problems.append("YouTube Data API v3 is not enabled in this Google Cloud project: "
                                "APIs & Services -> Library -> YouTube Data "
                                "API v3 -> Enable")
            elif "API key not valid" in msg or "keyInvalid" in msg:
                problems.append("The key is invalid -- copied incompletely or "
                                "from another project")
            elif "referer" in msg.lower() or "referrer" in msg.lower() or "ipRefererBlocked" in msg:
                problems.append("The key has an HTTP referrer / IP restriction -- "
                                "that does not work from a container. Credentials -> the key "
                                "-> Application restrictions -> None")
            elif "quota" in msg.lower():
                problems.append("Today's quota is exhausted, it resets at midnight "
                                "Pacific time")
            else:
                problems.append("The network to googleapis.com is not passing or the key was rejected "
                                "-- see the error text above")
    else:
        print("   skipped (no key)")

    print("3. Database")
    try:
        db.init_db()
        s = query.db_stats()
        print(f"   {s['db_path']}")
        print(f"   channels {s['channels']}, videos {s['videos']}, niches {s['niches']}, "
              f"snapshots {s['video_stat_snapshots']}")
        if s["videos"] == 0:
            problems.append("The database is empty -- start with "
                            "`python cli.py collect-channel @some-channel`")
        elif not s["history_since"]:
            problems.append("There is no history -- start the worker "
                            "(`docker compose up -d worker`), otherwise vph24h, "
                            "acceleration and channel growth stay null")
    except Exception as e:
        print(f"   ERROR: {e}")
        problems.append(f"The database does not open: {e}")

    print("4. LLM (optional)")
    llm_provider = os.environ.get("LLM_PROVIDER", "none").strip().lower()
    if llm_provider == "none":
        print("   off (LLM_PROVIDER=none) -- the default, nothing to fix")
    elif llm_provider == "ollama":
        from infrastructure.llm import factory as llm_factory
        provider = llm_factory.get_provider()  # always an OllamaProvider for this branch
        print(f"   provider=ollama model={llm_factory.display_model()} url={provider.base_url}")
        ok, msg = provider.available()
        print(f"   {msg}")
        if not ok:
            problems.append(f"Ollama: {msg} -- run `ollama serve` and "
                            "`ollama pull <model>`, or check OLLAMA_URL")
        elif args.llm:
            _ping_llm(problems)
        else:
            print("   server and model are in place, ping skipped (pass --llm)")
    else:
        from infrastructure.llm import factory as llm_factory
        has_key = bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
        print(f"   provider={llm_provider} model={llm_factory.display_model()} "
              f"key={'present' if has_key else 'MISSING'}")
        if not has_key:
            problems.append("LLM_PROVIDER=openrouter, but OPENROUTER_API_KEY is not set -- "
                            "NullProvider is used")
        elif args.llm:
            _ping_llm(problems)
        else:
            print("   key present, ping skipped (pass --llm to check and "
                  "spend a little budget)")

    print("5. Coverage of the 24h window")
    try:
        c = trends.coverage("24h")
        print(f"   videos in 24h: {c['videosPublishedInPeriod']} of "
              f"{c['videosTotal']}; speed metrics "
              f"{'available' if c['velocityMetricsAvailable'] else 'NOT available (history needed)'}")
    except Exception as e:
        print(f"   ERROR: {e}")

    print()
    if problems:
        print("WHAT TO FIX:")
        for i, p in enumerate(problems, 1):
            print(f"  {i}. {p}")
        return 1
    print("All good.")
    return 0


def cmd_collect_channel(args):
    from application import collecting as collector
    out(collector.collect_channel(_key(), args.channel, max_videos=args.max_videos,
                                  niche=args.niche, embed=args.embed))


def cmd_collect(args):
    from application import collecting as collector
    out(collector.collect_niche(_key(), args.query, label=args.label,
                                language=args.language, period=args.period,
                                pages=args.pages, region=args.region,
                                embed=args.embed))


def cmd_refresh(args):
    from application import collecting as collector
    out(collector.refresh_stats(_key(), scope=args.scope, period=args.period,
                                limit=args.limit))
    out(collector.refresh_channels(_key(), only_tracked=True))


def cmd_viral(args):
    from application import discovery as trends
    out(trends.viral_videos_small_channels(
        period=args.period, period_by=args.period_by,
        max_subscribers=args.max_subscribers, min_views=args.min_views,
        min_views_per_subscriber=args.min_vsr, niche=args.niche,
        sort_by=args.sort_by, limit=args.limit))


def cmd_categories(args):
    from application import discovery as trends
    out(trends.most_popular_categories(period=args.period, period_by=args.period_by,
                                       niche=args.niche, rank_by=args.rank_by,
                                       limit=args.limit))


def cmd_keywords(args):
    from application import discovery as trends
    out(trends.trending_keywords(period=args.period, period_by=args.period_by,
                                 niche=args.niche, top_n=args.limit,
                                 sort_by=args.sort_by, min_videos=args.min_videos))


def cmd_channels(args):
    from application import channel_tracking as tracking
    out(tracking.recently_added_outlier_channels(
        period=args.period, period_by=args.period_by,
        min_multiplier=args.min_multiplier, limit=args.limit))


def cmd_stats(args):
    from application import search as query
    out(query.db_stats())


def cmd_embed_videos(args):
    from application import collecting as collector
    out(collector.backfill_embeddings(limit=args.limit))


def cmd_fix_tracked(args):
    from application import channel_tracking as tracking
    out(tracking.fix_tracked(_key() or None, apply=args.apply))


def cmd_digest_send(args):
    from application import digest as digest_mod
    out(digest_mod.send_digest(force=True))


def cmd_notify_test(args):
    from infrastructure.notify import factory as notify_factory
    from infrastructure.notify.null import NullNotifier
    notifier = notify_factory.get_notifier()
    if isinstance(notifier, NullNotifier):
        out({"sent": False,
            "hint": "no NOTIFY_TELEGRAM_BOT_TOKEN/NOTIFY_TELEGRAM_CHAT_ID or "
                    "NOTIFY_WEBHOOK_URL set in .env"})
        return
    ok = notifier.send("\U0001F9EA niche-finder: test message. If you see this, "
                       "alerts are set up correctly.")
    out({"sent": ok, "channel": notify_factory.display_target()})


def cmd_export_niche(args):
    from application import niche_export as niche_export_uc
    try:
        result = niche_export_uc.export_niche(args.slug, fmt=args.format)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    path = args.out or result["filename"]
    with open(path, "wb") as f:
        f.write(result["content"])
    out({"written": path, "rows": result["rowCount"]})


def _read_password(args):
    """From stdin with --password-stdin (scripts), else asked twice without
    echo. Never taken from argv, where it would land in shell history."""
    if args.password_stdin:
        return sys.stdin.readline().rstrip("\n")
    import getpass
    first = getpass.getpass("password: ")
    if getpass.getpass("again: ") != first:
        print("error: the passwords differ", file=sys.stderr)
        sys.exit(1)
    return first


def cmd_create_user(args):
    from application import auth
    try:
        uid = auth.create_user(args.email, _read_password(args), is_admin=args.admin)
    except auth.AuthError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    out({"created": uid, "email": args.email.strip().lower(), "admin": args.admin})


def cmd_set_password(args):
    from application import auth
    try:
        uid = auth.set_password(args.email, _read_password(args))
    except auth.AuthError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
    out({"updated": uid, "sessionsEnded": True})


def cmd_create_token(args):
    from application import auth
    users = {u["email"]: u["id"] for u in auth.list_users()}
    uid = users.get(args.email.strip().lower())
    if uid is None:
        print(f"error: no user {args.email}", file=sys.stderr)
        sys.exit(1)
    out(auth.create_api_token(uid, args.name))


def cmd_users(args):
    from application import auth
    out(auth.list_users())


def cmd_seed(args):
    # cli.py now lives at backend/interfaces/cli/ (two levels deeper than the
    # old flat backend/cli.py), so climb back up to backend/ before reaching
    # into tests/.
    backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    sys.path.insert(0, os.path.join(backend_root, "tests"))
    from seed_demo import seed
    out(seed())


def main():
    ap = argparse.ArgumentParser(prog="cli.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("doctor", help="check the key, network, database")
    p.add_argument("--llm", action="store_true",
                   help="also ping the configured LLM provider (spends budget)")
    p.set_defaults(fn=cmd_doctor)
    sub.add_parser("stats", help="what is in the database").set_defaults(fn=cmd_stats)
    sub.add_parser("notify-test", help="test message to Telegram/webhook").set_defaults(
        fn=cmd_notify_test)
    sub.add_parser("digest-send", help="send the 24-hour digest right now").set_defaults(
        fn=cmd_digest_send)
    sub.add_parser("seed", help="load synthetic data").set_defaults(fn=cmd_seed)

    # plan 15: accounts for NF_MULTI_USER=1 -- by invitation, no sign-up page
    p = sub.add_parser("create-user", help="create a user (sign-in with NF_MULTI_USER=1)")
    p.add_argument("email")
    p.add_argument("--admin", action="store_true")
    p.add_argument("--password-stdin", action="store_true", help="read the password from stdin")
    p.set_defaults(fn=cmd_create_user)
    p = sub.add_parser("set-password", help="set or change a password (local -- your data)")
    p.add_argument("email")
    p.add_argument("--password-stdin", action="store_true", help="read the password from stdin")
    p.set_defaults(fn=cmd_set_password)
    sub.add_parser("users", help="list users").set_defaults(fn=cmd_users)
    p = sub.add_parser("create-token", help="a personal token for the extension and MCP over HTTP")
    p.add_argument("email")
    p.add_argument("--name", default=None)
    p.set_defaults(fn=cmd_create_token)

    p = sub.add_parser("embed-videos", help="compute missing embeddings for already collected videos (0 quota)")
    p.add_argument("--limit", type=int, default=1000)
    p.set_defaults(fn=cmd_embed_videos)

    p = sub.add_parser("export-niche", help="export a niche's videos to TSV/CSV")
    p.add_argument("slug")
    p.add_argument("--out", default=None, help="file path (default <slug>_videos_DATE.EXT)")
    p.add_argument("--format", choices=["tsv", "csv"], default="tsv")
    p.set_defaults(fn=cmd_export_niche)

    p = sub.add_parser("fix-tracked", help="clean the watchlist of handles/urls instead of channel_id")
    p.add_argument("--apply", action="store_true",
                   help="apply the changes (by default only a preview)")
    p.set_defaults(fn=cmd_fix_tracked)

    p = sub.add_parser("collect-channel", help="collect a channel (1 unit / 50 videos)")
    p.add_argument("channel")
    p.add_argument("--max-videos", type=int, default=100)
    p.add_argument("--niche")
    p.add_argument("--embed", action=argparse.BooleanOptionalAction, default=False,
                   help="compute embeddings right away (default: no)")
    p.set_defaults(fn=cmd_collect_channel)

    p = sub.add_parser("collect", help="collect a niche by search (1 of 100 searches per day)")
    p.add_argument("query")
    p.add_argument("--label")
    p.add_argument("--language")
    p.add_argument("--period")
    p.add_argument("--region")
    p.add_argument("--pages", type=int, default=1)
    p.add_argument("--embed", action=argparse.BooleanOptionalAction, default=True,
                   help="compute embeddings right away (default: yes)")
    p.set_defaults(fn=cmd_collect)

    p = sub.add_parser("refresh", help="refresh counters and append history")
    p.add_argument("--scope", default="recent", choices=["recent", "tracked", "niche", "all"])
    p.add_argument("--period", default="30d")
    p.add_argument("--limit", type=int, default=1000)
    p.set_defaults(fn=cmd_refresh)

    def period_args(p, default="7d"):
        p.add_argument("--period", default=default)
        p.add_argument("--period-by", default="published",
                       choices=["published", "discovered", "updated"])
        p.add_argument("--niche")
        p.add_argument("--limit", type=int, default=25)
        return p

    p = period_args(sub.add_parser("viral", help="viral videos from small channels"))
    p.add_argument("--max-subscribers", type=int, default=10000)
    p.add_argument("--min-views", type=int, default=10000)
    p.add_argument("--min-vsr", type=float, default=1.0)
    p.add_argument("--sort-by", default="viral")
    p.set_defaults(fn=cmd_viral)

    p = period_args(sub.add_parser("categories", help="popular categories"))
    p.add_argument("--rank-by", default="views", choices=["views", "channels", "videos"])
    p.set_defaults(fn=cmd_categories)

    p = period_args(sub.add_parser("keywords", help="trending keywords"), "24h")
    p.add_argument("--sort-by", default="momentum")
    p.add_argument("--min-videos", type=int, default=3)
    p.set_defaults(fn=cmd_keywords)

    p = period_args(sub.add_parser("channels", help="recently added outlier channels"), "24h")
    p.add_argument("--min-multiplier", type=float, default=2.0)
    p.set_defaults(fn=cmd_channels)
    p.set_defaults(period_by="discovered")

    args = ap.parse_args()
    sys.exit(args.fn(args) or 0)


if __name__ == "__main__":
    main()
