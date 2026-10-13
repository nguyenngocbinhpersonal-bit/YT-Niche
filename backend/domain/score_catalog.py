"""What every number on the screen is (plan 23): YouTube data or an estimate
of niche-finder, how it is computed, from what, and from how much data it
starts to mean something. One place for the dashboard's "?" tips, the help
page and the explain_scores MCP tool.

YouTube's derived-metrics policy asks API clients to keep their own metrics
visibly apart from API data and never present them as YouTube's
(developers.google.com/youtube/terms/derived-metrics-policy) -- `source`
is that line. Thresholds come from the modules that use them, so the text
cannot drift from the code.
"""
from domain import hook_scoring as HS
from domain import language_gaps as LG
from domain import metrics as M
from domain import milestones as MS
from domain import monetization as MZ
from domain import niche_ranking as NRK
from domain import outlier_traits as OTR
from domain import policy_signals as PS
from domain import repeatability as RP
from domain import saturation as SAT
from domain import template_risk as TR

YOUTUBE = "youtube"
ESTIMATE = "niche-finder"

_BANDS = ", ".join(f"<{t:g} {name}" for t, name in M.OUTLIER_BANDS if t != float("inf"))

CATALOG = {
    # ------------------------------------------------------- YouTube data
    "views": {"name": "Views", "source": YOUTUBE,
              "formula": "viewCount from the YouTube Data API at the time of the last snapshot",
              "inputs": ["videos.list / videos.batchGetStats"], "minSample": None},
    "subscribers": {"name": "Subscribers", "source": YOUTUBE,
                    "formula": "subscriberCount from the YouTube Data API; YouTube rounds it to three "
                               "significant digits and does not return a hidden count",
                    "inputs": ["channels.list"], "minSample": None},
    "likesComments": {"name": "Likes and comments", "source": YOUTUBE,
                      "formula": "likeCount / commentCount from the YouTube Data API",
                      "inputs": ["videos.list"], "minSample": None},
    # ------------------------------------------------- estimates of ours
    "outlierScore": {
        "name": "Multiplier (outlier)", "source": ESTIMATE,
        "formula": f"video views / median views of the channel's previous {M.DEFAULT_BASELINE_N} "
                   "uploads of the same format (Shorts and long videos separately); bands: " + _BANDS,
        "inputs": ["video views", "views of the channel's past videos from the database"],
        "minSample": "4 collected videos of the channel; fewer — a multiplier against the lifetime mean (≈)"},
    "outlierScoreAgeAdjusted": {
        "name": "Age-adjusted multiplier", "source": ESTIMATE,
        "formula": "views / (channel median × maturation curve(age)) — a young video "
                   "is compared with what an ordinary video gains by the same age",
        "inputs": ["multiplier", "maturation curve (own, if calibrated)"],
        "minSample": "same as the multiplier"},
    "vsr": {"name": "VSR", "source": ESTIMATE,
            "formula": "views / channel subscribers — how far the video went beyond its audience",
            "inputs": ["views", "subscribers"], "minSample": None},
    "vph": {"name": "VPH", "source": ESTIMATE,
            "formula": "view gain between snapshots / hours between them; without history — "
                       "views / hours since publication. Snapshot pairs across 24.08.2026 are not used",
            "inputs": ["worker snapshots"], "minSample": "2 snapshots"},
    "acceleration": {"name": "Acceleration", "source": ESTIMATE,
                     "formula": "VPH today / VPH yesterday; > 1.5 — speeding up, < 0.7 — cooling",
                     "inputs": ["worker snapshots over 48 h"], "minSample": "snapshots over 2 days"},
    "momentumGrade": {"name": "Momentum and grade", "source": ESTIMATE,
                      "formula": "views per day over 30 days / the channel's lifetime average; "
                                 "the grade is a letter by log2 of this ratio (a Social Blade idea)",
                      "inputs": ["channel snapshots"], "minSample": "snapshots over 30 days"},
    "revenueRange": {"name": "Revenue and RPM", "source": ESTIMATE,
                     "formula": "monthly views / 1000 × niche RPM × "
                                f"{M.MONETISATION_DISCOUNT}; shown as a range ÷{M.RPM_SPREAD:g}…"
                                f"×{M.RPM_SPREAD:g}: public estimates for one niche differ by up to 7x. "
                                "AdSense only, no sponsors",
                     "inputs": ["views", "the video's YouTube category"], "minSample": None},
    "trendScore": {"name": "trendScore, lift, phrase momentum", "source": ESTIMATE,
                   "formula": "lift = P(outlier | phrase in title) / P(outlier); momentum = the phrase's "
                              "share now / in the previous window; trendScore = ln(1 + videos) × lift × "
                              "momentum. The API has no search volume — and so neither do we",
                   "inputs": ["titles and tags of collected videos"], "minSample": "phrase in 3+ videos"},
    "nicheTrend": {"name": "Niche trend", "source": ESTIMATE,
                   "formula": f"the last {SAT.RECENT_DAYS} days against the {SAT.BASE_DAYS} before them: "
                              "supply (videos), demand (median forecast of views), new channels, "
                              f"the share of newcomers with outlier ≥ ×{SAT.BREAKOUT:g}",
                   "inputs": ["niche videos over 120 days"],
                   "minSample": f"{SAT.MIN_VIDEOS} videos in each window"},
    "templateRisk": {"name": "Template risk", "source": ESTIMATE,
                     "formula": "a weighted mean of four signals: title similarity "
                                f"({TR.WEIGHTS['similarity']:g}), a shared title skeleton "
                                f"({TR.WEIGHTS['templateShare']:g}), identical video length "
                                f"({TR.WEIGHTS['durationCv']:g}), an even upload schedule "
                                f"({TR.WEIGHTS['cadenceCv']:g}); a heuristic, not a YouTube verdict",
                     "inputs": ["the channel's latest uploads"],
                     "minSample": f"{TR.MIN_VIDEOS} uploads"},
    "hookScore": {"name": "Intro score", "source": ESTIMATE,
                  "formula": "points for text features of the first ~30 seconds: "
                             + ", ".join(f"{k} {v}" for k, v in HS.MAX_POINTS.items())
                             + f"; weak < {HS.LEVEL_WEAK_BELOW}, strong ≥ {HS.LEVEL_STRONG_FROM}. "
                             "Text only, not the picture; correlation, not cause",
                  "inputs": ["pasted transcript"], "minSample": None},
    "titleScore": {"name": "Title score", "source": ESTIMATE,
                   "formula": "50 ± length in range (±10), a number (+5), the niche's outlier patterns "
                              "(up to +20), a near-duplicate of one already filmed (−30); with an LLM — its score alongside",
                   "inputs": ["title", "niche patterns"], "minSample": None},
    "ideaVerdict": {"name": "Idea verdict", "source": ESTIMATE,
                    "formula": "matches of the idea in the database (meaning and occurrence in a title): none — "
                               "open; recent — filmed recently; old with outlier ≥ ×2 — demand "
                               "proven; otherwise — flopped",
                    "inputs": ["embeddings and titles of collected videos"], "minSample": None},
    "ypp": {"name": "YPP thresholds", "source": ESTIMATE,
            "formula": "which partner-program thresholds the channel visibly passes: subscribers, "
                       "uploads and Shorts views over 90 days from collected videos (a lower bound); "
                       f"from {MZ.RULES_2027_FROM.isoformat()} — the 2027 rules. Watch hours cannot be "
                       "learned via the API. Not a monetization status",
            "inputs": ["subscribers", "collected videos over 90 days"], "minSample": None},
    "milestones": {"name": "Subscriber milestones", "source": ESTIMATE,
                   "formula": "a straight line at the subscriber growth pace over 30 and 90 days to the next "
                              "round number",
                   "inputs": ["channel snapshots"],
                   "minSample": f"{MS.MIN_POINTS} snapshots over {MS.MIN_SPAN_DAYS}+ days"},
    "repeatability": {"name": "Is the format repeated?", "source": ESTIMATE,
                      "formula": "videos of other channels similar in meaning: how many channels got an "
                                 f"outlier ≥ ×{RP.HIT_SCORE:g} (a channel counts once); "
                                 f"{RP.MIN_HIT_CHANNELS}+ — repeated",
                      "inputs": ["embeddings", "multipliers"],
                      "minSample": f"{RP.MIN_VIDEOS} similar videos from {RP.MIN_CHANNELS}+ channels"},
    "languageGap": {"name": "Another language", "source": ESTIMATE,
                    "formula": "outliers in the source language and the nearest videos in meaning in the target "
                               f"(similarity ≥ {LG.MIN_SIMILARITY}): none — not made; present, but none is an "
                               f"outlier ≥ ×{LG.HIT_SCORE:g} — made weakly; an outlier exists — already a "
                               "hit. Alongside: how many other channels in the source language repeated the format",
                    "inputs": ["embeddings", "multipliers", "video language"],
                    "minSample": f"{LG.THIN_CORPUS_VIDEOS}+ videos in the target language, otherwise \"not made\" "
                                 "may mean \"not collected\""},
    "profit": {"name": "Net profit", "source": ESTIMATE,
               "formula": "revenue (views / 1000 × RPM: low / mid / high) minus the profile's costs: "
                          "per video + per minute × length, for a month — plus fixed costs. "
                          "\"Profitable\" if even the lower bound is positive, \"loss-making\" if even the "
                          "upper bound is negative, otherwise \"unclear\". AdSense only; for a connected channel — the real RPM",
               "inputs": ["views", "category RPM or your real one", "cost profile"],
               "minSample": None},
    "outlierTraits": {"name": "What breakouts have in common", "source": ESTIMATE,
                      "formula": f"outliers (≥ ×{OTR.OUTLIER_MIN:g}) against ordinary videos "
                                 f"(≤ ×{OTR.ORDINARY_MAX:g}) within a format (Shorts and long videos separately): "
                                 f"the share with a trait (notable — a difference of {OTR.MIN_DIFF_PP} pp or more) or "
                                 f"the median (notable — {OTR.MIN_RATIO:g}x or more). Correlation, "
                                 "not cause; with a dozen traits one or two line up by chance",
                      "inputs": ["titles", "duration", "tags", "publication time", "multipliers"],
                      "minSample": f"{OTR.MIN_GROUP}+ videos in each group"},
    "nicheRank": {"name": "Where to enter", "source": ESTIMATE,
                  "formula": "0–100 from six weighted terms: " + ", ".join(
                      f"{NRK.LABELS[k].lower()} {w}" for k, w in NRK.WEIGHTS.items()) +
                             ". Each term is 0–100 points on a linear scale, the total is a weighted "
                             "mean of the known ones; the weights are a judgement, RPM is an estimate. No score if the niche "
                             "trend is \"not enough data\"",
                  "inputs": ["niche trend", "newcomers", "category RPM", "channel templating",
                             "policy signals"],
                  "minSample": f"trend: {SAT.MIN_VIDEOS}+ videos in each window; {round(NRK.MIN_COVERAGE * 100)}%+ "
                               "of the weight known"},
    "expectedCurve": {"name": "Expected trajectory", "source": ESTIMATE,
                      "formula": "channel median views × maturation curve(age)",
                      "inputs": ["channel median", "maturation curve"],
                      "minSample": "4 collected videos of the channel"},
    "policySignals": {"name": "Monetization-policy signals", "source": ESTIMATE,
                      "formula": "three categories of \"inauthentic\" content: templating (template risk, "
                                 "similar thumbnails), shock (the share of titles with shock markers: high from "
                                 f"{round(PS.SHOCK_HIGH * 100)}%), AI persona (a sensitive topic in "
                                 f"{round(PS.SENSITIVE_SHARE * 100)}%+ of videos plus disclosed AI or a faceless "
                                 "channel — no higher than \"worth watching\"). No overall percentage, not a YouTube decision",
                      "inputs": ["titles", "YouTube topics", "AI disclosure", "thumbnails", "AI labels"],
                      "minSample": f"{PS.MIN_TITLES} titles; templating — {TR.MIN_VIDEOS} uploads"},
    "ownFormats": {"name": "Formats of your own channel", "source": ESTIMATE,
                   "formula": "from your YouTube Analytics data by creatorContentType: the share of views and "
                              "subscribers per 1000 views by format; Pearson r between weekly "
                              "Shorts and long-video views; watch hours of long videos and streams over 365 days and the date "
                              "of the threshold at the 30-day pace (not YouTube's \"qualified watch hours\")",
                   "inputs": ["your channel via OAuth"], "minSample": "8 weeks for the format link"},
    "topicMatch": {"name": "Topic match", "source": ESTIMATE,
                   "formula": "cosine of the embeddings of the topic and of a video's title with description ≥ the topic threshold",
                   "inputs": ["embeddings"], "minSample": None},
}


def catalog(key: str = None) -> dict:
    if key is None:
        return {"scores": CATALOG, "sources": {YOUTUBE: "YouTube API data",
                                               ESTIMATE: "niche-finder estimate, not YouTube data"}}
    if key not in CATALOG:
        raise KeyError(key)
    return {key: CATALOG[key]}
