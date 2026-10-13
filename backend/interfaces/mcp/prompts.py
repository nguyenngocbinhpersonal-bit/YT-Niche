"""Ready-made scenarios (MCP prompts, plan 11): a Claude client lists them under
"+", and picking one puts a step-by-step instruction into the chat -- which of
our tools to call, in what order, what it costs in quota and what the answer
should look like. The client's own model runs the steps; the server spends
nothing on the prompt itself.

Texts are in English because they land in the chat as the user's message.
Tool names are written as `name(` so tests/test_mcp_prompts.py can check that
every tool a scenario names still exists.
"""

from typing import Annotated

from pydantic import Field

TOPIC = Annotated[str, Field(description="The topic of the future channel, as it would be searched on YouTube")]
PAGES = Annotated[str, Field(description="How many search pages to take, 1–3 (each one is 1 of 100 "
                                         "searches per day)")]
CHANNEL = Annotated[str, Field(description="Channel: @handle, UC… id or link")]
IDEA = Annotated[str, Field(description="A video idea in one phrase")]
NICHE = Annotated[str, Field(description="Niche slug from list_niches")]
VIDEO = Annotated[str, Field(description="ID of the video that broke out (11 characters)")]
USE_LLM = Annotated[str, Field(description="yes / no — add the server's LLM analysis")]
PERIOD = Annotated[str, Field(description="Window: 24h, 7d, 30d")]

ANSWER = "Answer in the user's language. Take numbers from the tools' responses, don't invent them."
QUOTA_GUARD = ("Before any collecting call `db_stats()` and look at search_quota."
               "search_calls_left_today and unit_quota.units_left_today. If what remains is not enough — "
               "stop and say how much is left and when it resets (midnight Pacific "
               "time).")


def _pages(value) -> int:
    try:
        return max(1, min(int(value), 3))
    except (TypeError, ValueError):
        return 1


def _steps(*lines) -> str:
    return "\n".join(f"{i}. {line}" for i, line in enumerate(lines, 1))


def register(mcp):
    @mcp.prompt(name="find_niche", title="Find a niche",
                description="Evaluate a topic as a niche: collects videos (if there are none yet), shows "
                            "saturation, trend, viral videos of small channels and template risk. "
                            "Quota: 1 search of 100 per day per page, if there is no data yet.")
    def find_niche(topic: TOPIC, pages: PAGES = "1") -> str:
        n = _pages(pages)
        steps = _steps(
            "Call `list_niches()`. If a niche with this query already exists and was collected in the last 7 days — "
            "skip collecting and use its slug.",
            QUOTA_GUARD + f" Collecting needs search_calls_left_today to be at least {n + 5}.",
            f"If there is no data: `collect_niche(query=\"{topic}\", pages={n})`. Don't take more than {n} pages.",
            "`niche_overview(niche=<slug>)` — channel sizes, medians, and separately saturation_v2 (the trend: "
            "growing / stable / cooling / saturated / not enough data, with reasons and confidence).",
            "`viral_videos_small_channels(niche=<slug>, period=\"30d\")` — what breaks out "
            "for channels under 10k.",
            "`niche_template_risk(niche=<slug>)` — what share of channels looks like a templated assembly line.",
        )
        return f"""Evaluate the topic "{topic}" as a niche for a new YouTube channel.

Quota: up to {n} search requests of 100 per day (pages={n}) and roughly {n} units, only if the niche
is not collected yet. The other steps are free.

{steps}

Answer: a short table "indicator — value — what it means" (channels, median views,
the trend and its reasons, small-channel breakouts, share of templated channels), then 3–5 examples
of viral videos from small channels and a conclusion in 2–3 sentences: whether to enter and with which format.
If the trend is "not enough data" or confidence is low — say so, don't draw a conclusion stronger than the data.
{ANSWER}"""

    @mcp.prompt(name="analyze_competitor", title="Analyse a competitor",
                description="A full channel analysis: growth, best videos, title phrases, best "
                            "publishing time, similar channels. Quota: ~2–3 units, does not spend search.")
    def analyze_competitor(channel: CHANNEL) -> str:
        steps = _steps(
            QUOTA_GUARD + " 10 units are enough for this scenario.",
            f"`collect_channel(channel=\"{channel}\", max_videos=100)` — take the channel_id from the response.",
            "`channel_analytics(channel_id=<id>)` — growth, cadence, median against mean, best outliers.",
            "`title_patterns(channel_id=<id>)` — which title phrases are tied to breakouts.",
            "`best_time_to_publish(channel_id=<id>)` — the best days and hours (UTC).",
            "`similar_channels(channel_id=<id>, limit=5)` — who it shares an audience with in our database.",
        )
        return f"""Analyse the channel {channel} as a competitor.

Quota: collecting the channel takes 1 unit per 50 videos (about 2–3 units for 100 videos) and does not spend
search requests. The other steps are free.

{steps}

Answer: the channel profile (subscribers, frequency, median views), the 3–5 best videos with their multiplier,
phrase patterns, the best time, similar channels, and 3 concrete conclusions: what is worth borrowing from it and
where it is weak. The growth fields are empty until there are snapshots from several days — say so if that is the case.
{ANSWER}"""

    @mcp.prompt(name="validate_idea", title="Validate an idea",
                description="Whether such videos already exist in the niche and how they performed, a score for "
                            "title variants and who is about to become a competitor. Quota: 0.")
    def validate_idea(idea: IDEA, niche: NICHE) -> str:
        steps = _steps(
            f"`check_ideas(ideas=[\"{idea}\"], niche=\"{niche}\")` — the verdict free / recent / proven / "
            "flopped and similar videos.",
            "Come up with 5 title variants for this idea and score them: "
            f"`score_titles(candidates=[...], niche=\"{niche}\")`.",
            f"`high_future_competition(niche=\"{niche}\", period=\"30d\")` — young fast channels "
            "that may take this topic.",
        )
        return f"""Validate the video idea "{idea}" for the niche {niche}.

Quota: 0 — all steps read only the local database.

{steps}

Answer: a one-line verdict (make it / make it with another angle / don't make it) and why, a table
of titles with scores (best first), 2–3 similar videos if any, and which young channels
are nearby. {ANSWER}"""

    @mcp.prompt(name="outlier_to_video", title="Outlier → your own video",
                description="A brief for your own video from one video that broke out: hook, "
                            "niche patterns, whether the topic is taken, titles, thumbnail references. Quota: 0.")
    def outlier_to_video(video_id: VIDEO, use_llm: USE_LLM = "yes") -> str:
        llm = str(use_llm).strip().lower() not in ("no", "нет", "false", "0")
        steps = _steps(
            f"`build_brief(video_id=\"{video_id}\", use_llm={str(llm).lower()}, save=false)`.",
            f"`format_repeatability(video_id=\"{video_id}\")` — whether the format was repeated by other channels. "
            "If 'one_off' — say honestly that it may be one-off luck; 'unknown' means "
            "\"too little collected\", not \"doesn't work\".",
            "Look at skipped: name plainly everything that could not be collected (for example, no transcript — "
            "suggest pasting it on the \"Transcripts\" screen).",
            "If the brief is useful, ask whether to save it to drafts, and only after consent call "
            f"`build_brief(video_id=\"{video_id}\", use_llm={str(llm).lower()}, save=true)`.",
        )
        return f"""Make a brief for my video based on the video that broke out, {video_id}.

Quota: 0. With use_llm=true the server's LLM budget is spent (if one is configured).

{steps}

Answer: why the video broke out, whether the format is repeated, the hook, whether the topic is taken (what is already filmed),
3–5 titles, and my angle — how my video should differ, not how to copy it. {ANSWER}"""

    @mcp.prompt(name="weekly_review", title="Weekly review",
                description="What happened over a period: new outliers, accelerations, repackaging, "
                            "vanished channels, new strong channels. Quota: 0.")
    def weekly_review(period: PERIOD = "7d") -> str:
        steps = _steps(
            f"`daily_digest(period=\"{period}\")` — summary: outliers, accelerations, rising channels.",
            "`list_events(unseen_only=true)` — unseen alerts.",
            f"`packaging_changes(period=\"{period}\")` — who changed a title or thumbnail and what happened to "
            "views.",
            f"`recently_added_outlier_channels(period=\"{period}\")` — new channels that immediately "
            "outperform their level.",
        )
        return f"""Make a review for the period {period} of my tracked channels and the database.

Quota: 0 — all steps read only the local database.

{steps}

Answer: 5–7 points "what happened → what to do about it", the most important first. If there is no data
for the period — say that the worker may not be running. {ANSWER}"""

    @mcp.prompt(name="find_content_gaps", title="Content gaps",
                description="Viewer questions from comments that the niche has no video for yet, "
                            "and a brief for the chosen one. Quota: 0 from the cache; reading comments is "
                            "1 unit per video and only with your consent.")
    def find_content_gaps(niche: NICHE) -> str:
        steps = _steps(
            f"`content_gaps(niche=\"{niche}\", fetch=false)` — cache only.",
            "If skippedVideos contains videos with reason=not-fetched — say how many there are and how many units "
            "that costs, and ask whether to read the comments. Only if the user agrees: "
            + QUOTA_GUARD + f" Then `content_gaps(niche=\"{niche}\", fetch=true)`.",
            "Show the gaps and ask which one to make a brief for. For the chosen one: "
            "`build_brief(video_id=<first of sourceVideos>, gap_topic=<topic>, save=false)`.",
        )
        return f"""Find the content gaps of the niche {niche}: what viewers ask about but no video exists.

Quota: 0 while the cache is read. Reading comments costs 1 unit per unread video (usually
up to 10), and only after the user agrees.

{steps}

Answer: a table of gaps (question, status, how many times asked, nearest existing video),
a note on the mode (LLM or rules — there is more noise without an LLM) and the database size from coverageBase: a gap
is only as real as the database is complete. {ANSWER}"""

    @mcp.prompt(name="niche_health", title="Niche health",
                description="A niche check before entering: trend, channel templating, sponsors, "
                            "outlier hooks. Quota: 0.")
    def niche_health(niche: NICHE) -> str:
        steps = _steps(
            f"`niche_overview(niche=\"{niche}\")` — take saturation_v2: status, reasons, confidence.",
            f"`niche_template_risk(niche=\"{niche}\")` — the share of templated channels (a risk for the whole niche).",
            f"`sponsor_map(niche=\"{niche}\")` — whether brands pay the niche's creators and which ones.",
            f"`niche_hook_benchmark(niche=\"{niche}\")` — how outlier hooks differ (if there are enough "
            "transcripts).",
        )
        return f"""Check the health of the niche {niche} before entering it.

Quota: 0 — all steps read only the local database.

{steps}

Answer: a traffic light for four points (trend, templating, money, hooks) with numbers and a conclusion in 2–3
sentences. Don't turn "not enough data" into a conclusion — suggest what to collect. {ANSWER}"""
