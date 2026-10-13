/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, esc, sectionHead, table } from '../ui.js';
import { view } from '../shared.js';

/* ------------------------------------------------------------- Help */

async function viewHelp() {
  view.innerHTML = `
    <div class="card">
      ${sectionHead('What this is', 'a free local alternative to NexLev Niche Finder')}
      <div class="prose">
        <p class="lead"><strong>niche-finder</strong> is your own tool for finding niches and viral videos on
          YouTube: the same sections as NexLev / vidIQ / ViewStats (viral videos from small
          channels, top categories, rising keywords, channel analysis and tracking), but built on the
          free YouTube Data API v3 and a local Postgres database (with pgvector for semantic
          search) — no subscription and no one else's server.</p>
        <p>It works in two forms at once: as an <strong>MCP server</strong> for Claude Desktop
          (instructions are on the separate "MCP connection" page in the left menu) and as this
          <strong>web dashboard</strong>, which you have open right now. Both read the same database and
          the same formulas — the numbers cannot disagree between them.</p>
        <p>All the basic sections work without any LLM key: the server returns raw numbers,
          titles and thumbnails, and judgement calls like "faceless / fits the topic" can be made by
          the model that calls the MCP tools in a conversation. Optionally you can connect an
          LLM (<code>LLM_PROVIDER</code>: OpenRouter, including free models, or a local
          Ollama) — that enables background AI channel labels, "why it broke out", comment
          summaries, title generation, cluster names on the niche map and auto-tags.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Screens', 'what each item in the left menu shows')}
      <div class="prose">
        <h4>Overview</h4>
        <p>Everything at once in a single request: top outlier channels, who is about to become a competitor, categories,
          keywords and viral videos for the selected period. The starting point of every session.
          At the top is "Last 24 hours": the same thing that arrives in the morning Telegram digest with NOTIFY_MODE=digest.</p>
        <h4>Find a niche</h4>
        <p>Semantic search over the already collected database (by embeddings of titles and descriptions) — free,
          no quota. Filters: minimum multiplier, maximum subscribers, RPM estimate, video length,
          Shorts. At the bottom is the collect form, which does spend quota.</p>
        <h4>Viral videos</h4>
        <p>Videos from small channels that broke out more than expected. It has filters (subscribers,
          views, period) and a "filter funnel" at the bottom — it shows which exact threshold cut the results
          off when the list is empty.</p>
        <h4>Outlier channels</h4>
        <p>The same at channel level: the best multiplier among its videos in the window and a strength band
          0–4. The ≈ mark next to a multiplier means it was computed with a rougher formula — see the question
          about it in the FAQ below.</p>
        <h4>Categories</h4>
        <p>A ranking of YouTube categories for the period with the share shift against the previous window of the same
          length — you can rank by views or by channel count.</p>
        <h4>Keywords</h4>
        <p>Rising phrases (n-grams) from titles with momentum and outlier lift — how much more strongly videos with this
          phrase break out on average than the rest.</p>
        <h4>Top tags by category</h4>
        <p>Authors' YouTube tags as whole tags, by category: how many videos, share and outlier lift —
          a lift above 1.5 means the tag is tied to breakouts rather than just being popular.</p>
        <h4>Channel tracker</h4>
        <p>A watchlist: the background worker refreshes the channels here regularly, so only for them do
          subscriber growth, grade and the "views over time" tab appear over time. If an
          LLM is connected, the list can be filtered by AI labels (faceless, format, topic).</p>
        <h4>Alerts</h4>
        <p>Events for tracked channels — the same as what goes to Telegram or a webhook: outlier,
          acceleration, title change, comeback after a pause, a vanished channel or video. Filter by type
          and "new only". A channel counts as gone after two API misses at least
          6 hours apart (deleted, hidden or blocked), and a red mark appears on its screen.
          An exhausted quota or an API error does not count as a disappearance. No quota is spent.</p>
        <h4>My topics</h4>
        <p>On the "Alerts" screen you can name a topic in your own words — for example, "AI agents for small business".
          When a new video that is close to it in meaning (embeddings of title and description) enters the database,
          you get a personal "Topic" alert: only you see it. It searches among what the database collects — the RSS
          of tracked channels, niches, trends — and not all of YouTube. The 0.6 threshold is a starting point; if
          the matches are too distant, raise it. From the extension, a topic is added by the "Follow topic" button
          in the video panel. No quota is spent. With the "On YouTube" box checked, the topic is also searched once a day across all of
          YouTube for the last day — that is one search of the 100 per day for the whole installation, and no more than 5 topics per day.</p>
        <h4>Idea check</h4>
        <p>One idea per line → a verdict from your database: open, filmed recently, demand proven or
          flopped. The result can be exported to CSV.</p>
        <h4>Calendar</h4>
        <p>Drafts (from the brief and "Metadata review") by release day — week or month. Drag a draft onto a day
          to schedule it, or click it and set an exact time. Time is shown in your time zone and
          stored in UTC. The editor shows the niche's best publishing time (in UTC) and whether you hit it: this is a correlation,
          not a guarantee. A reminder arrives in Telegram and in the digest a day before release and at release time — until the
          draft is linked to a published video (the "link" button on "Metadata review"). Overdue
          drafts are highlighted. No quota is spent.</p>
        <h4>Collaboration partners</h4>
        <p>A block on the channel screen and on "My channels": who to make a joint video with or swap mentions with. We take
          the 200 channels most similar by topic (by the meaning of their videos) and keep those of your size (from ×0.5 to ×2
          of your subscribers) that posted a video in the last 30 days and don't look like a templated assembly line. Next to each —
          similarity, size, when the last video was and subscriber growth over 30 days; under the table — how many were filtered out and why.
          The "Track" button adds the channel to the tracker. Only among collected channels; YouTube provides no contacts —
          reach out via the links on the channel. No quota is spent.</p>
        <h4>Net profit</h4>
        <p>A card on the channel and niche screens: ad revenue minus your production costs. Costs are set by
          profiles on the "Data" screen: price per video (editing, stock), price per minute of video (voiceover, generation) and
          fixed monthly costs (subscriptions). For a channel a month is computed: its views and long videos over 30 days;
          for a niche — a typical video (median views and length) and a month of such videos. Revenue is a range, because nobody
          publishes RPM, so profit is a range too; "unclear" is an honest answer for most niches. "Breaks even at" —
          how many views a video needs to pay back its cost. For a connected channel your real RPM is used.
          If the channel does not reach the full YPP tier (1,000 subscribers), ads may not pay yet — we
          warn about it. AdSense only, no sponsors. No quota is spent.</p>
        <h4>What breakouts have in common</h4>
        <p>A card on the niche screen and in the brief: how outliers (from ×3) differ from ordinary videos (up to ×1.5) of the same
          niche — a number or a question in the title, brackets, an all-caps word, emoji, video and title length, number of
          tags, weekends and time of day of publication (UTC). Computed from the numbers, no AI, Shorts and long videos separately.
          Only differences that are notable are shown: from 15 pp for shares or 1.3x for medians, with 10+ videos
          in each group; sample sizes are shown alongside, the rest is collapsed. If more than half of the outliers come from one
          channel, those are its habits, not the niche's: we warn about that. This is a correlation, not a cause, and with a dozen
          traits one or two may line up by chance. No quota is spent.</p>
        <h4>Where to enter</h4>
        <p>All niches in one table with a score of 0–100. The score is a weighted sum of six terms: demand (the trend of
          views over 30 days against the 90 before), supply (whether output is growing — the faster, the more crowded),
          newcomers (the share of young channels that broke out), RPM, the share of templated channels and monetization-policy
          signals. Each cell has 0–100 points and the value itself; clicking a header sorts by any
          column. The weights are our judgement, and RPM is an estimate, not YouTube data. A niche without a score is too small to
          judge: it is not "bad", it is just not rated. Select 2–3 niches and press "Compare selected" — all the numbers
          line up side by side. The calculation is cached for an hour, "Recalculate" refreshes it. No quota is spent.</p>
        <h4>Another language</h4>
        <p>A format broke out in one language — has it been made in another? Pick a pair of languages: we show the outliers of the
          source language and, for each, whether the target language has a video similar in meaning. "Not made" — there is no similar one;
          "made weakly" — there is, but none is an outlier; "already a hit" — a similar video already worked there.
          "More channels" — how many other channels in the source language repeated the format. This is an estimate from your database:
          if few videos are collected in the target language (fewer than 200), "not made" may mean "not collected" — a hint
          appears at the top. Similarity across languages is computed more strictly than within one: the default threshold is 0.62.
          A niche limits only the source videos. From the extension — the "In another language?" button. No quota is spent.</p>
        <h4>Transcripts</h4>
        <p>A manual queue: transcripts are never downloaded automatically — the text is pasted in
          by hand, after which hybrid search (vector + full-text) works over it. The "Hook" button on a
          finished transcript scores the first ~30 seconds from the text: a question to the viewer, a number, a promise, intrigue,
          addressing the viewer as "you", a short first phrase, pace; minus points for greetings and "subscribe". This scores the text,
          not the picture or the editing, and it is a correlation, not causation. The LLM analysis, when ticked, sends the text to the
          provider and may cost money. The niche benchmark works from 10 outlier transcripts and 10 ordinary videos.</p>
        <h4>Niche map</h4>
        <p>Channels grouped by k-means over the embeddings of their videos: niches found without manual
          labelling, with median multiplier, speed, faceless share and number of large competitors.
          The "Trend" column is the same as for a niche; it does not affect the order of clusters.</p>
        <h4>Score titles</h4>
        <p>A title score of 0–100 by the patterns of the selected niche and a check for duplicates of already published
          videos; generating new titles requires an LLM. The "Check the intro" card: paste the first
          20–30 seconds of the script, get a score and tips; the text is not stored anywhere and is not sent anywhere.</p>
        <h4>Saved</h4>
        <p>Swipe file: videos and channels saved from the extension, with a snapshot of metrics at the time of
          saving, a folder and a note.</p>
        <h4>Styles and similar thumbnails</h4>
        <p>On the niche screen — groups of thumbnails similar by picture and how each performs (median multiplier and
          views), plus a thumbnail search by description ("red arrow, shocked face", better in English). In the brief —
          "Similar by picture": who else has a thumbnail that looks the same. The CLIP neural network compares locally: style and
          content, not text overlays. Vectors are computed by a button on the niche screen or by the worker
          (<code>WORKER_THUMB_EMBED=1</code>, off by default): the models take about 0.6 GB on disk and up to
          0.7 GB of memory during computation, about a second per thumbnail including the download, thumbnails are downloaded from i.ytimg.com, no quota is spent, only the vector is stored.</p>
        <h4>Repackaging</h4>
        <p>Title and thumbnail changes after publication: "before / after" side by side and views per hour
          for 48 hours before and after the change. A thumbnail change is not visible in the API (the image link does not change),
          so the worker compares the images itself for tracked channels — the history starts from
          the moment the channel was added to the tracker. The effect is an observation, not a cause.</p>
        <h4>Sponsors</h4>
        <p>Which brands pay creators in a niche or on a channel: the share of videos with a sponsor or promo code, top brands,
          average views of videos with and without a sponsor. Data comes from video descriptions (a sponsor mention,
          promo code, affiliate link) in Russian and English; affiliate links, such as Amazon, are shown
          separately and are not counted as sponsorship. This is a lower bound: an integration not named in the description is not visible.</p>
        <h4>Content gaps</h4>
        <p>A card on the niche screen: viewer questions and requests from the comments of the most viewed videos
          that have no video or transcript in the database yet. Similar questions are merged; those asked more often,
          with more likes and under several videos rank higher. Comments are read only on a button press
          (1 unit of quota per video) and afterwards come from the cache. Without an LLM, questions are picked by rules (a question mark,
          "make a video", "how to" and so on, Russian and English) — there is more noise. A gap is only as real as the
          database is complete. The "To brief" button opens a brief for that question.</p>
        <h4>Brief from an outlier</h4>
        <p>The "brief" link on a video card assembles a starting point for your video: a hook from a pasted
          transcript, the niche's title patterns, whether the topic is taken, thumbnail references. First a free
          preview without an LLM; the "Add LLM analysis" button gives an angle and title candidates (may cost
          money), "Save to drafts" creates a draft linking to the source video. What could not be
          collected is named at the end. This is research, not a script: pick your own angle.</p>
        <h4>Trajectory and compare</h4>
        <p>In the brief and on the compare screen (the "compare" link on a video card, up to 5 videos): how a video gained
          views by age — in hours and days since publication, not by date, so videos from different days stand side by side.
          The points are worker snapshots (every 3 hours during the first week, then once a day up to 30 days); a dashed line of the same
          colour shows how many views an ordinary video of this channel would have by the same age, which is an estimate. Marks on the curve are a
          title or thumbnail change. For a video found late the start of the curve is missing: "observed from …".</p>
        <h4>Is the format repeated?</h4>
        <p>A block in the brief and a button in the extension's video panel: videos of other channels similar in meaning and whether
          they became outliers. "Repeated" — three or more channels with a multiplier from ×2; "one-off luck" — no one
          else; "not enough data" — fewer than five similar videos collected. A channel is counted once, by its best
          video, so that a channel that repeated itself does not look like confirmation. An estimate from the collected database:
          channels that repeated the format may simply not be collected. No quota is spent.</p>
        <h4>Metadata review</h4>
        <p>A check of a draft title/description/tags against your database — separate signals with sample
          sizes, not one made-up "SEO score". A draft can be saved and later linked to a
          published video to check the prediction.</p>
        <h4>Niches</h4>
        <p>A list of the topics under which you collected data (the <code>niche</code> field when collecting). Inside a
          niche — a summary, a scatter of views by publication date, hit rate by tag groups, videos with a
          tag editor, a comment digest and an export to TSV/CSV. Also here is the share of niche channels
          that look like a templated assembly line: where there are many, copying the format is risky.</p>
        <h4>Niche trend</h4>
        <p>A block on the niche screen and a column in the niche list: growing, stable, cooling or saturated. The last
          30 days are compared with the 90 days before them, regardless of the selected period: how many videos come out,
          how new videos perform (a forecast of views at day 30, so old and fresh ones are comparable),
          how many channels were created and whether newcomers break out. Fewer than 20 videos in one of the windows — "not enough data".
          A "?" on the status means low confidence: we did not catch most videos young, and the growth may be
          just that more was collected recently.</p>
        <h4>My channels</h4>
        <p>Connect your own channels through Google (your own OAuth client, read-only access) and you will see their real
          numbers from YouTube Analytics: views, retention, revenue, CPM and RPM, next to niche medians and our estimate of
          RPM from public data. Thumbnail CTR is not in the API — only in YouTube Studio. The token is stored encrypted,
          numbers refresh once a day; "Disconnect" revokes access at Google and deletes everything saved. Setup is
          step by step on the screen itself.</p>
        <p>The "Formats" block on the same screen: Shorts, long videos and live streams separately — the share of views
          and how many subscribers each thousand views brings; whether Shorts and long-video views move together
          (a weekly correlation, not a cause); watch hours of long videos and streams over 365 days towards the YPP threshold
          (4,000 now, 8,000 from 01.02.2027) and an approximate date at the current pace. This is an approximation: YouTube counts
          "qualified watch hours" by its own rules.</p>
        <h4>YPP threshold</h4>
        <p>A line on the channel screen and in the extension panel: which YouTube Partner Program thresholds the channel
          passes by public data — 500 or 1,000 subscribers, 3 uploads and Shorts views over 90 days
          (from collected videos, so at least). Watch hours cannot be learned via the API. This is not a monetization
          status: YouTube does not publish it, and on-page signs (ads, the "Sponsor" button)
          turned out to be unreliable or not visible to everyone. "Find a niche" and "Outlier channels" have a "YPP thresholds"
          filter: keep only channels that have the subscribers or passed the threshold via Shorts.
          Channels with a hidden subscriber count do not pass the filter. From 01.02.2027 YouTube raises the threshold
          for new creators: 1,000 subscribers and 8,000 hours over 365 days or 20M Shorts views over 90 days;
          until that date it is shown alongside how the channel looks under the new rules.</p>
        <h4>Subscriber milestones</h4>
        <p>On the channel screen and in the extension panel: when the channel will reach the next round numbers
          (1,000, 10,000, 100,000…) at the growth pace of the last 30 and 90 days. This is a straight line over our snapshots,
          not YouTube data; with few snapshots or no growth there is no date. If a tracked channel
          passes a milestone, a "Milestone" alert arrives.</p>
        <h4>Monetization-policy signals</h4>
        <p>A block on the channel and niche screens and a line in the extension's channel panel. The YouTube monetization rules
          describe "inauthentic" content in three categories: templated and repetitive, built on shock and
          emotional manipulation, and an AI persona acting as an expert in health, law, finance or politics.
          For each it shows which signals are visible in public data: template risk and similar thumbnails,
          the share of titles with shock markers, a sensitive topic plus disclosed AI or a faceless channel. Levels:
          "no signals", "worth watching", "clear signals". There is no overall percentage: the decision is made by
          people at YouTube. An AI persona cannot be seen in public data, so this category never rises above
          "worth watching". Reused content is a separate rule and is not included here.</p>
        <h4>Template risk</h4>
        <p>A block on the channel and niche screens: how closely the latest videos resemble one repeatable template
          (similar titles, the same opening and ending, even duration and release rhythm).
          This is a heuristic over public patterns, not a YouTube decision: series, podcasts and music
          channels can also get a high score. At least 10 recent videos with embeddings are needed.</p>
        <h4>Data</h4>
        <p>The state of the API key, the database and history, plus collect forms and a manual stats refresh.
          The first stop if some section looks empty or suspicious.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('How to read the metrics', 'glossary')}
      <dl class="glossary">
        <div><dt>Multiplier / outlier score</dt>
          <dd>A video's views divided by the median views of the channel's previous 10 ordinary (non-Shorts)
            uploads. The age-normalised version additionally adjusts for
            how many days the video has been live — otherwise a fresh video unfairly loses to an old one.</dd></div>
        <div><dt>The ≈ mark next to a multiplier</dt>
          <dd>There are fewer than 4 videos of this channel in the database — there is nothing to compute a median baseline from, and the number
            falls back to the NexLev formula: views divided by the channel's lifetime average. One
            viral video inflates such an average several times over, so the figure is approximate. Fixed
            by one collect — <code>collect_channel</code> for the whole channel.</dd></div>
        <div><dt>VSR (views per subscriber)</dt>
          <dd>Views per subscriber — how far a video went beyond its subscriber
            base, into other people's recommendations.</dd></div>
        <div><dt>VPH (views per hour)</dt>
          <dd>"All time" is simply views divided by hours since publication, which is the VPH badge
            at NexLev. "24 hours" is how many views the video gained specifically in the last day;
            it appears only once a history of snapshots has accumulated for it.</dd></div>
        <div><dt>Acceleration</dt>
          <dd>Today's VPH divided by yesterday's VPH. Above 1 — speeding up, below 1 — fading.</dd></div>
        <div><dt>Momentum / channel grade</dt>
          <dd>Views per day over the last 30 days divided by views per day over the channel's whole life,
            converted to the Social Blade A++…D scale.</dd></div>
        <div><dt>RPM and revenue estimate</dt>
          <dd>Niche RPM is shown as a "from–to" range, not a single number: the midpoint is an estimate by YouTube category
            (as at NexLev) with a 0.7 adjustment for non-monetized views, the edges are half and double.
            This is fairer: YouTube does not publish RPM by topic, and public estimates for one niche differ
            by up to 7 times. The RPM filter in search compares the midpoint. All revenue estimates are ads only
            (AdSense), without sponsorship integrations; those are shown by the "Sponsor map". The real RPM of your own
            channels is visible in "My channels" next to our range.</dd></div>
        <div><dt>period / period_by</dt>
          <dd><code>period_by="published"</code> (the default) — what came out in the window by publication date.
            <code>period_by="discovered"</code> — what we first saw ourselves in the window, regardless of
            publication date. At NexLev, "Last 24 hours" contains videos from a year ago —
            that is exactly the discovered mode; to reproduce its behaviour, switch to discovered.</dd></div>
        <div><dt>Filter funnel and hint</dt>
          <dd>If a section returned nothing, the bottom of the page shows how many videos remained after each
            filter and an explanation of which threshold cut everything off. An empty result almost always
            means "nothing is collected for this window", not "nothing is trending".</dd></div>
      </dl>
    </div>

    <div class="card">
      ${sectionHead('Getting started', 'day one')}
      <div class="prose">
        <p>1. On the "Data" page enter a channel (@handle, UC-id or link) and press
          <strong>"Collect channel"</strong>. This goes through the uploads playlist — about 1 unit of
          quota per 50 videos, search is not spent. Repeat for 20–50 channels in your topic.</p>
        <p>2. If there is no topic in the database at all yet, use the search query field
          (<strong>"Collect by search"</strong>). It is the only one that spends search: 1 of 100 calls per day.</p>
        <p>3. Browse the sections — they are free, refresh as many times as you like with the "Refresh" button
          in the header.</p>
        <p>4. Keep the worker running (<code>docker compose up -d worker</code>): after a day
          VPH over 24 hours and the gain appear, after a week — channel growth and momentum, after a month —
          you can recalculate the maturation curve for your niches.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('FAQ', 'frequently asked questions')}
      <div class="faq">
        <details>
          <summary>A section returned nothing — what is wrong?</summary>
          <div class="a">Almost never "nothing is trending" — almost always "nothing is collected for this
            window" or a filter threshold cut off all the rows. Scroll down to the "Filter funnel" block:
            it shows at which step the list became empty, and a hint on what to do about it. Also check
            the window on the "Data" page — it shows how many videos actually fall in the
            selected period.</div>
        </details>
        <details>
          <summary>What does "last 24 hours" mean?</summary>
          <div class="a">By default — by publication date (<code>period_by=published</code>). There is a
            second mode, <code>discovered</code> — by the date the system first saw the
            video itself. More in the glossary above, under "period / period_by".</div>
        </details>
        <details>
          <summary>Why does the channel multiplier have a ≈ mark?</summary>
          <div class="a">It means there are fewer than 4 videos of this channel in the database, and the multiplier was computed with the rougher
            NexLev formula (views / lifetime average) instead of the median of past
            uploads. Collect the whole channel via <code>collect_channel</code>, and the mark disappears
            by itself as soon as there are 4 or more videos.</div>
        </details>
        <details>
          <summary>How much does this cost in YouTube quota?</summary>
          <div class="a">Search (<code>collect_niche</code>) is a separate bucket, only 100 calls
            per day. Everything else — collecting a channel, refreshing stats, reading sections — comes from the
            shared pool of 10,000 units per day and costs pennies: about 1 unit per 50 videos. The dashboard
            sections (viral videos, categories, keywords, channel analytics) are completely free —
            they read the already collected database and do not go to YouTube again.</div>
        </details>
        <details>
          <summary>I changed the code but the changes are not visible</summary>
          <div class="a">If you edited <code>frontend/*</code> (HTML/CSS/JS) — just reload
            the page, the folder is mounted into the container read-only. If you edited
            <code>backend/*.py</code> — the web server (uvicorn) does not reread code on the fly even with a
            mounted folder, the process needs a restart:
            <code>docker compose restart web</code>. Rebuilding the image (<code>docker compose build</code>)
            is needed only when <code>requirements.txt</code> changes.</div>
        </details>
        <details>
          <summary>Docker builds forever and fails with a Docker Hub error</summary>
          <div class="a">This is the network, not the code: <code>lookup auth.docker.io: i/o timeout</code> means
            Docker could not reach the image registry. Most often an enabled VPN is to blame — turn it off
            and retry; if that did not help, restart Docker Desktop. To check:
            <code>curl -sI https://auth.docker.io/token</code> and <code>docker pull hello-world</code>.</div>
        </details>
        <details>
          <summary>Where do VPH over 24 hours, acceleration and growth come from?</summary>
          <div class="a">The YouTube API gives only "how many views right now" — a snapshot with no
            history. All the speed metrics exist only because the background worker regularly
            records these snapshots. Without a running <code>docker compose up -d worker</code> such
            fields stay empty no matter how many channels you collected.</div>
        </details>
        <details>
          <summary>Is this the same as NexLev?</summary>
          <div class="a">The same sections and, where possible, the same formulas (cross-checked in
            <code>outlierScoreNexlev</code>), but local, free and with one improvement: the baseline
            for the multiplier is the median of the channel's past uploads, not the lifetime average,
            which one viral video can distort by 20x or more.</div>
        </details>
        <details>
          <summary>Do I need a paid AI key to classify niches?</summary>
          <div class="a">No. Without an LLM the server returns raw data (titles, descriptions, thumbnails,
            numbers), and judgement calls like "this is a faceless channel" or "fits this niche"
            are made by the model that calls the MCP tools in a conversation — you already have it in
            Claude Desktop. If you want labels to be set automatically in the background, set
            <code>LLM_PROVIDER</code> in <code>.env</code>: OpenRouter (there are free models,
            the daily budget is limited) or a local Ollama — then nothing leaves your
            machine.</div>
        </details>
        <details>
          <summary>The key does not work or the quota suddenly ran out</summary>
          <div class="a">Run the diagnostics: <code>make doctor</code> (or
            <code>docker compose run --rm mcp python cli.py doctor</code>). It checks in order
            the key format, that the API actually responds, whether YouTube Data API v3 is enabled in
            Google Cloud Console, IP/referrer restrictions on the key and the state of the database — and prints
            a concrete list of what to fix.</div>
        </details>
      </div>
    </div>
    <div class="card" id="helpScores"></div>`;
  fillScores();
}

/* Plan 23: every number is either YouTube data or a niche-finder estimate, and how it is
   calculated. The same catalog as the "?" hints and the explain_scores MCP tool. */
async function fillScores() {
  const box = document.querySelector('#helpScores');
  try {
    const d = await api('/api/scores');
    const rows = Object.values(d.scores).sort((a, b) => (a.source === b.source ? 0 : a.source === 'youtube' ? -1 : 1));
    box.innerHTML = `${sectionHead('Where each number comes from', 'YouTube data kept apart from niche-finder estimates — the YouTube API rules forbid passing off your own metrics as YouTube data')}
      ${table([
        { label: 'Number', wrap: true, render: (r) => `<b>${esc(r.name)}</b>` },
        { label: 'Source', render: (r) => (r.source === 'youtube' ? 'YouTube data'
          : '<span class="est">niche-finder estimate</span>') },
        { label: 'How it is calculated', wrap: true, render: (r) => esc(r.formula) },
        { label: 'Sample size', wrap: true, render: (r) => esc(r.minSample || '—') },
      ], rows)}`;
  } catch { box.remove(); }
}

export { viewHelp };
