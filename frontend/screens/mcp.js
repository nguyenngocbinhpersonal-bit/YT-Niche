/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, esc, ago, toast, sectionHead, notice, empty } from '../ui.js';
import { view } from '../shared.js';

/* ---------------------------------------------------------------- MCP */

async function viewMcp() {
  view.innerHTML = `
    <div class="card">
      ${sectionHead('MCP connection', 'how to give Claude Desktop access to your database')}
      <div class="prose">
        <p class="lead">MCP (Model Context Protocol) is what turns niche-finder from a
          dashboard into a set of tools that Claude uses right in the conversation: it collects
          data, finds viral videos, analyses channels and decides for itself which of the findings is relevant to
          your topic. The dashboard (the "Help &amp; FAQ" page next to this one) and the MCP server read the same
          Postgres database — you can collect data from anywhere and view the result somewhere else.</p>
        <p>There are 100 tools in total. Only the <strong>collect</strong> tools spend YouTube quota;
          everything else — <strong>sections</strong>, tracking and channel analysis, tags, ideas, titles,
          alerts, saved items, transcripts — reads the already collected database for free. A separate group of
          <strong>LLM features</strong> works only if <code>LLM_PROVIDER</code> is set.
          A short overview of the groups is below.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Connecting via Docker', 'the recommended way — the same image as the dashboard')}
      <div class="prose">
        <p>Open
          <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>
          and add:</p>
        <pre><code>{
  "mcpServers": {
    "niche-finder": {
      "command": "/path/to/youtube-niche-finder/scripts/mcp-docker.sh"
    }
  }
}</code></pre>
        <p>The script runs <code>server.py</code> in the <code>niche-finder:latest</code> image,
          attaches the container to the <code>niche-finder_default</code> network (where the Postgres from
          compose lives), mounts <code>backend/</code> read-only and the shared volume
          <code>niche-finder-models</code>. It parses the variables from <code>.env</code> itself: it strips the
          quotes around values (with <code>docker run --env-file</code> they would end up in the value
          together with it) and skips <code>NICHE_DATABASE_URL</code> — that is the database address from the host,
          it does not work inside the container. That is why you should use the script instead of a hand-written <code>docker run</code>
          command.</p>
        <p>The network appears only after the first <code>docker compose up</code> — first start
          at least the database: <code>docker compose up -d postgres</code>.</p>
        <p>After editing the config, fully restart Claude Desktop (not just close the window —
          quit the app), otherwise it will not reread the server list.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Connecting via HTTPS', 'for clients that prefer a URL to a process')}
      <div class="prose">
        <pre><code>docker compose --profile http up -d mcp-http mcp-https</code></pre>
        <p>The server listens on <code>https://localhost:8765/mcp</code> (127.0.0.1 only). Client config:</p>
        <pre><code>{
  "mcpServers": {
    "niche-finder": { "url": "https://localhost:8765/mcp", "type": "http" }
  }
}</code></pre>
        <p>TLS is terminated by Caddy with a certificate from its own local CA (<code>tls internal</code>),
          so the root certificate of that CA must be added to the system's trusted certificates once.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Connecting without Docker', 'if you run the backend directly, via a venv')}
      <div class="prose">
        <pre><code>cd /path/to/youtube-niche-finder/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in YOUTUBE_API_KEY</code></pre>
        <p>Postgres still has to run somewhere — the easiest is to start it from compose
          (<code>docker compose up -d postgres</code>, on the host it is on port 5433) and set in
          <code>.env</code> <code>NICHE_DATABASE_URL=postgresql://niches:niches@localhost:5433/niches</code>.</p>
        <p>Config:</p>
        <pre><code>{
  "mcpServers": {
    "niche-finder": {
      "command": "/path/to/youtube-niche-finder/backend/.venv/bin/python3",
      "args": ["/path/to/youtube-niche-finder/backend/server.py"]
    }
  }
}</code></pre>
        <p>In this mode history is not collected on its own — the background worker is not running, so run
          <code>python3 worker.py</code> separately (or via cron), otherwise the speed fields (VPH over 24h,
          acceleration, growth) stay empty.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Scenarios', 'ready-made workflows: Claude calls the right tools in order by itself')}
      <div class="prose">
        <p>In Claude Desktop press "+" in the input field → <b>niche-finder</b>, pick a scenario and fill in the
          fields. A step-by-step instruction lands in the chat: which tools to call, what it costs in quota
          and in what form to answer. Scenarios that collect data first check the remaining quota
          via <code>db_stats</code> and stop if there is not enough.</p>
        <ul>
          <li><b>Find a niche</b> (<code>find_niche</code>: topic, search pages) — collecting if the niche does not exist yet,
            saturation and trend, viral videos of small channels, template risk. Quota: 1 search of 100
            per page, only if there is no data.</li>
          <li><b>Analyse a competitor</b> (<code>analyze_competitor</code>: channel) — growth, best videos,
            title patterns, best time, similar channels. Quota: ~2–3 units.</li>
          <li><b>Validate an idea</b> (<code>validate_idea</code>: idea, niche) — whether it has been filmed, title
            scores, future competitors. Quota: 0.</li>
          <li><b>Outlier → your own video</b> (<code>outlier_to_video</code>: video id) — a brief, saved to drafts
            only with your consent. Quota: 0.</li>
          <li><b>Weekly review</b> (<code>weekly_review</code>: period) — outliers, accelerations,
            repackaging, new strong channels. Quota: 0.</li>
          <li><b>Content gaps</b> (<code>find_content_gaps</code>: niche) — viewer questions without
            a video and a brief for the chosen one. Quota: 0 from the cache; reading comments costs 1 unit per video and only
            with your consent.</li>
          <li><b>Niche health</b> (<code>niche_health</code>: niche) — trend, templating, sponsors,
            hooks of outliers. Quota: 0.</li>
        </ul>
        <p>New scenarios appear after a full restart of Claude Desktop: the script mounts the code from
          the repository. Rebuilding the image (<code>docker compose build</code>) is needed only if your
          config does not mount <code>backend/</code>.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Tools', 'collecting spends quota, sections and tracking are free')}
      <div class="prose">
        <h4>Collect</h4>
        <ul>
          <li><code>collect_niche</code> — search by topic → videos, channels, embeddings. 1 search
            call of 100 per day.</li>
          <li><code>collect_channel</code> — a channel's uploads via the uploads playlist. ~1 unit / 50 videos,
            does not spend search. The main way to build a corpus.</li>
          <li><code>collect_trending</code> — a snapshot of the mostPopular chart (Music/Movies/Games).</li>
          <li><code>refresh_stats</code> — reread video counters, append a snapshot to history.</li>
          <li><code>refresh_channels</code> — a snapshot of channel subscribers/views.</li>
          <li><code>refresh_categories</code> — the current id → category name map.</li>
          <li><code>video_comments</code> — comments of one video live, without saving (1 unit).</li>
          <li><code>backfill_embeddings</code> — embeddings for videos collected without them (does not
            spend quota, computed locally).</li>
        </ul>
        <h4>Sections</h4>
        <ul>
          <li><code>viral_videos_small_channels</code>, <code>recently_added_outlier_channels</code>,
            <code>high_future_competition</code> — viral videos/channels for a period.</li>
          <li><code>most_popular_categories</code>, <code>trending_keywords</code>,
            <code>top_tags_by_category</code> — top categories, rising phrases and tags.</li>
          <li><code>search_outliers</code>, <code>similar_channels</code>, <code>similar_videos</code> —
            semantic search over the database (pgvector).</li>
          <li><code>niche_overview</code>, <code>niche_overview_from_channel</code>,
            <code>niche_videos</code>, <code>niche_map</code> — niche saturation, its videos and the map of
            niches by channel clusters. The <code>saturation_v2</code> field is the trend: the last 30 days against
            the 90 before (growing / stable / cooling / saturated / not enough data) with reasons and numbers.</li>
          <li><code>template_risk</code>, <code>niche_template_risk</code> — how closely a channel's uploads (or the niche's channels) resemble one template: the YouTube "inauthentic content" risk. A heuristic, not a verdict.</li>
          <li><code>check_ideas</code> — batch idea checking against the database.</li>
          <li><code>list_niches</code>, <code>db_stats</code>, <code>data_coverage</code> — what is collected and
            whether the data suffices for the window.</li>
        </ul>
        <h4>Tags</h4>
        <ul>
          <li><code>tag_videos</code>, <code>list_video_tags</code>, <code>tag_stats</code>,
            <code>list_proposed_tags</code> / <code>resolve_proposed_tag</code> — your own video labelling
            and which angle really breaks out.</li>
        </ul>
        <h4>Tracking and channel analysis</h4>
        <ul>
          <li><code>track_channel</code> / <code>untrack_channel</code> / <code>list_tracked_channels</code> —
            the watchlist.</li>
          <li><code>channel_analytics</code>, <code>compare_channels</code>, <code>channel_velocity</code> —
            profile, cadence, growth, momentum, grade, projections, revenue.</li>
          <li><code>title_changes</code>, <code>title_patterns</code>, <code>best_time_to_publish</code>,
            <code>calibrate_maturity_curve</code> — finer analyses.</li>
        </ul>
        <h4>Alerts, titles, saved items, transcripts</h4>
        <ul>
          <li><code>sponsor_map</code>, <code>channel_sponsors</code> — which brands creators name in the descriptions of a niche's or channel's videos: sponsors and promo codes separately from affiliate links, average views "with / without a sponsor". A lower bound: only what is written in the description.</li>
          <li><code>packaging_changes</code> — title and thumbnail changes after publication: "before / after" and what happened to views.</li>
          <li><code>own_channels</code>, <code>own_vs_niche</code>, <code>rpm_calibration</code>,
            <code>sync_own_channels</code> — the real numbers of your own channels from YouTube Analytics (after connecting
            on the "My channels" screen): views, retention, revenue, RPM next to the niche and our RPM estimate.</li>
          <li><code>similar_thumbnails</code>, <code>search_thumbnails</code>, <code>thumbnail_styles</code>,
            <code>embed_thumbnails</code> — thumbnails similar by picture, thumbnail search by description and a niche's thumbnail styles
            with how they perform. Thumbnail vectors are required (the worker with <code>WORKER_THUMB_EMBED=1</code>
            or <code>embed_thumbnails</code>); no quota is spent.</li>
          <li><code>daily_digest</code> — a summary of the last 24 hours (the same as the morning Telegram digest), without sending.</li>
          <li><code>scan_for_alerts</code>, <code>list_events</code>, <code>mark_events_seen</code> —
            new outliers, acceleration, title change, a channel's comeback after a pause, a vanished channel or video.</li>
          <li><code>build_brief</code> — a brief for your own video from one outlier: hook, niche patterns, whether the topic is taken, titles and thumbnail references; missing parts are named honestly, without an LLM there is no angle and no new titles.</li>
          <li><code>score_titles</code>, <code>review_metadata</code>, <code>save_draft</code> /
            <code>list_drafts</code> / <code>link_draft</code>, <code>draft_outcomes</code> — checking
            titles and metadata, drafts and comparing the prediction with the outcome.</li>
          <li><code>save_item</code>, <code>list_saved_items</code>, <code>delete_saved_item</code> —
            swipe file.</li>
          <li><code>request_transcript</code>, <code>list_transcript_queue</code>,
            <code>search_transcripts</code> — the manual transcript queue and hybrid search over it.</li>
          <li><code>hook_report</code>, <code>niche_hook_benchmark</code>, <code>score_hook_text</code> — scoring an intro (the first ~30 seconds of a pasted transcript or your text) by text features: a question, a number, a promise, intrigue. A score of the words, not the picture; the LLM analysis only on explicit request and it costs money.</li>
        </ul>
        <h4>LLM features (<code>LLM_PROVIDER</code> required)</h4>
        <ul>
          <li><code>explain_outlier</code>, <code>comment_insights</code>,
            <code>niche_comment_insights</code> — why a video broke out and what people ask for in the comments.</li>
          <li><code>content_gaps</code> — viewer questions and requests from the comments of a niche's top videos that have no video in the database yet: demand, examples, the nearest video. Works without an LLM too (rules, more noise). Cache only by default; <code>fetch=true</code> — 1 unit of quota per unread video.</li>
          <li><code>suggest_titles</code>, <code>enrich_channels</code>, <code>tag_new_videos</code> —
            title generation, AI channel labels and auto-tags.</li>
        </ul>
        <p>Full descriptions, quota costs and formulas are in <code>backend/README.md</code> in the project
          folder.</p>
      </div>
    </div>

    <div class="card">
      ${sectionHead('Checking the connection', 'diagnostics and first commands')}
      <div class="prose">
        <p>If Claude Desktop does not see the server or tools fail with an error — run
          diagnostics first, don't guess:</p>
        <pre><code>make doctor
# or: docker compose run --rm mcp python cli.py doctor</code></pre>
        <p>It checks in order the key format, that the API actually responds, whether YouTube
          Data API v3 is enabled, IP/referrer restrictions on the key, the state of the database and the coverage of the 24-hour window —
          and prints a list of what to fix instead of just "error". With the <code>--llm</code> flag
          (<code>python cli.py doctor --llm</code>) it also pings the configured LLM.</p>
        <p>In Claude Desktop itself, once the server is connected, you can simply ask in plain language —
          for example: <em>"Collect the channel @Inkexplainer96 and show its viral videos for 30 days"</em>
          or <em>"Which categories are growing fastest over the last week?"</em> — the model
          will choose and call the right tools by itself.</p>
      </div>
    </div>

    <div class="card">
      ${notice('The MCP server is not the same as the web dashboard: Claude Desktop starts a fresh process for every conversation, so edits to <code>backend/*.py</code> are picked up by MCP on their own at the next Claude Desktop start. A permanently running dashboard (<code>docker compose up -d web</code>), however, needs <code>docker compose restart web</code> after Python edits — more in the "Help &amp; FAQ" section.')}
    </div>
    <div id="apiTokens"></div>`;
  loadTokens();
}

/* Plan 15 (5.7-5.8): personal tokens for the extension and MCP over HTTP -- only on a
   server with sign-in. The token is shown once, only its hash stays in the database. */
async function loadTokens() {
  const box = $('#apiTokens');
  if (!box) return;
  let me;
  try { me = await api('/api/auth/me'); } catch { return; }
  if (!me.multiUser || !me.user) return;
  let d = { tokens: [] };
  try { d = await api('/api/auth/tokens'); } catch (e) { box.innerHTML = notice(esc(e.message), 'error'); return; }
  box.innerHTML = `<div class="card">
    ${sectionHead('Personal tokens', 'for the browser extension and MCP over HTTP on a server with sign-in',
      `<input type="text" id="tokenName" placeholder="name: laptop, extension…" style="width:220px">
       <button class="btn btn-sm" id="tokenCreate" type="button">Create token</button>`)}
    <div id="tokenFresh"></div>
    ${d.tokens.length ? `<ul class="digest-list">${d.tokens.map((t) => `<li style="white-space:normal">
        <b>${esc(t.name || 'unnamed')}</b> · created ${esc(ago(t.createdAt))}
        · ${t.lastUsedAt ? `used ${esc(ago(t.lastUsedAt))}` : 'not used yet'}
        <button class="btn btn-ghost btn-sm js-token-off" data-id="${t.id}" type="button">Revoke</button></li>`).join('')}</ul>`
      : empty('no tokens yet')}
    <div class="section-sub">Extension: paste the token in its settings (the "Access token" field). MCP over HTTP:
      header <code>Authorization: Bearer &lt;token&gt;</code>. The token acts as you — your channels, drafts,
      alerts and your quota. If it leaks, revoke it here.</div>
  </div>`;
  $('#tokenCreate').addEventListener('click', async () => {
    try {
      const t = await api('/api/auth/tokens', { method: 'POST', body: { name: $('#tokenName').value.trim() } });
      await loadTokens();
      $('#tokenFresh').innerHTML = notice(`Copy it now — it will not be shown again: <code>${esc(t.token)}</code>`, 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });
  box.querySelectorAll('.js-token-off').forEach((btn) => btn.addEventListener('click', async () => {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Really revoke?'; return; }
    try { await api(`/api/auth/tokens/${btn.dataset.id}`, { method: 'DELETE' }); loadTokens(); }
    catch (e) { toast(e.message, 'err'); }
  }));
}

export { viewMcp };
