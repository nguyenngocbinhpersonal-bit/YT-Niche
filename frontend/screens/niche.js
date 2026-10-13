/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, mult, ago, esc, toast, sectionHead, notice, empty, barList, scatterChart, sponsorBlock, state, nicheTemplateRiskBlock, nichePolicyBlock, outlierTraitsBlock, mountProfit } from '../ui.js';
import { view, plabel, nicheOverviewBlock, render } from '../shared.js';

/* Hit rate by the tags of one group -- a barList from tag_stats. The group is entered
   as free text (tags are arbitrary: theme/trigger/format/...), so
   we remember the last chosen one in localStorage. */
function tagStatsSection(stats, tagGroup) {
  const body = stats.found === false
    ? empty(stats.hint || 'no tags in this group yet')
    : barList((stats.tags || []).map((t) => ({
        name: t.tag, value: t.hitRate, display: `${t.hitRate}%`,
        tip: `${t.tag}: ${t.videos} videos, hitRate ${t.hitRate}%, lift ${t.lift ?? '—'}`,
      })));
  return `
    <div class="card">
      ${sectionHead('Hit rate by tag', stats.found === false ? '' :
          `group “${esc(tagGroup)}” · niche base rate ${stats.baseRate}%`,
        `<input type="text" id="tagGroupInput" value="${esc(tagGroup)}"
           placeholder="tag group" style="width:140px">`)}
      ${body}
    </div>`;
}

/* Manual tag editing for a video -- each change sends replace:true with the full
   new set of this group's tags for the video (see application/tags.py:
   replace keeps the protected manual/claude-mcp tags even when the call
   comes with a different source; here source is always 'manual'). */
/* The comment Insights panel (stage 04) -- strictly on click, never
   automatic: it spends YouTube quota + may spend money on the LLM. */
function insightsPanelHtml(d) {
  if (d.hint) return notice(esc(d.hint));
  const pains = d.pains || [];
  const requests = d.requests || [];
  const ideas = d.video_ideas || [];
  const s = d.sentiment;
  const meta = d.cached ? 'from cache' : `quota spent: ${d.quotaSpent ?? 0}`;
  if (!pains.length && !requests.length && !ideas.length) {
    return empty(`The LLM found no significant signals in the comments (${meta})`);
  }
  return `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px">
      ${s ? `<div class="row-sub" style="margin-bottom:8px">
        Sentiment: ${Math.round(s.positive * 100)}% positive ·
        ${Math.round(s.neutral * 100)}% neutral ·
        ${Math.round(s.negative * 100)}% negative · ${meta}</div>` : ''}
      ${pains.length ? `<div style="margin-bottom:8px"><b>Pain points</b>
        <ul style="margin:4px 0 0 18px">${pains.map((p) => `<li>${esc(p.text)}
          (~${p.count_estimate})${p.quotes?.[0] ? ` <span class="row-sub">«${esc(p.quotes[0])}»</span>` : ''}</li>`).join('')}</ul></div>` : ''}
      ${requests.length ? `<div style="margin-bottom:8px"><b>Requests</b>
        <ul style="margin:4px 0 0 18px">${requests.map((r) => `<li>${esc(r.topic)}
          <span class="row-sub">«${esc(r.evidence)}»</span></li>`).join('')}</ul></div>` : ''}
      ${ideas.length ? `<div><b>Video ideas</b>
        <ul style="margin:4px 0 0 18px">${ideas.map((i) => `<li>${esc(i.title)}
          <span class="row-sub">— ${esc(i.why)}</span></li>`).join('')}</ul></div>` : ''}
    </div>`;
}

function wireCommentInsights() {
  view.querySelectorAll('.insights-btn').forEach((btn) => btn.addEventListener('click', async () => {
    const videoId = btn.dataset.insightsVideoId;
    const panel = view.querySelector(`.insights-panel[data-insights-video-id="${CSS.escape(videoId)}"]`);
    if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = empty('Loading… (spends YouTube quota and, if the LLM is enabled, money)');
    btn.disabled = true;
    try {
      const d = await api(`/api/videos/${encodeURIComponent(videoId)}/insights`,
        { method: 'POST', body: {} });
      panel.innerHTML = insightsPanelHtml(d);
    } catch (e) {
      panel.innerHTML = notice(esc(e.message));
    } finally {
      btn.disabled = false;
    }
  }));
  const nicheBtn = $('#nicheInsightsBtn');
  if (nicheBtn) nicheBtn.addEventListener('click', async () => {
    const panel = $('#nicheInsightsPanel');
    if (!panel) return;
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = empty('Loading…');
    nicheBtn.disabled = true;
    try {
      const d = await api(`/api/niches/${encodeURIComponent(nicheBtn.dataset.slug)}/insights`);
      panel.innerHTML = d.found === false ? notice(esc(d.hint)) : insightsPanelHtml(d);
    } catch (e) {
      panel.innerHTML = notice(esc(e.message));
    } finally {
      nicheBtn.disabled = false;
    }
  });
}

/* Content gaps (plan 03): viewer questions from the comments of top videos in the
   niche that have no video in the database yet. The screen reads only the cache (GET, 0 quota);
   comments of unread videos -- strictly on a button press (POST, 1 unit per video). */
const GAP_STATUS = { free: ['open', 'chip-good'], partial: ['partly covered', 'chip-warn'] };
const GAP_SKIP = {
  'not-fetched': 'comments not read yet',
  'quota-exhausted': 'YouTube quota exhausted',
  'no-comments': 'no comments',
  'llm-unavailable': 'LLM unavailable',
  error: 'error',
};

function gapItemHtml(g) {
  const st = GAP_STATUS[g.status] || [g.status, ''];
  const src = g.sourceVideos[0];
  const near = g.nearestVideo || g.nearestTranscript;
  return `<li style="white-space:normal;margin-bottom:10px">
    <div><span class="chip ${st[1]}">${esc(st[0])}</span> <b>${esc(g.topic)}</b></div>
    <div class="row-sub">questions: ${g.askers} · likes: ${compact(g.likes)} · source videos: ${g.sourceVideos.length}
      · demand ${esc(g.demand)}${g.coverage != null ? ` · coverage ${Math.round(g.coverage * 100)}%` : ''}</div>
    ${g.examples.filter((e) => e !== g.topic).map((e) => `<div class="row-sub">«${esc(e)}»</div>`).join('')}
    ${near ? `<div class="row-sub">Closest: ${g.nearestVideo
      ? `<a href="https://www.youtube.com/watch?v=${esc(g.nearestVideo.videoId)}" target="_blank" rel="noopener">${esc(g.nearestVideo.title)}</a>`
      : `transcript “${esc(g.nearestTranscript.title || g.nearestTranscript.videoId)}”`}
      (${Math.round((near.similarity || 0) * 100)}%)</div>` : ''}
    <a class="btn btn-ghost btn-sm" style="margin-top:4px"
       href="#/brief/${encodeURIComponent(src)}?gap=${encodeURIComponent(g.topic)}">To brief</a>
  </li>`;
}

function gapsBlock(d, slug) {
  if (!d) return '';
  const notRead = (d.skippedVideos || []).filter((s) => s.reason === 'not-fetched').length;
  const other = (d.skippedVideos || []).filter((s) => s.reason !== 'not-fetched');
  const base = d.coverageBase || {};
  const sub = `${d.mode === 'llm' ? 'questions extracted by the LLM' : 'questions picked by rules'}
    · checked against ${compact(base.videos)} videos and ${compact(base.transcripts)} transcripts of the niche`;
  const btn = notRead ? `<button class="btn btn-ghost btn-sm" id="gapsFetch" data-slug="${esc(slug)}" type="button">
    Read comments: ${notRead} videos (quota ~${notRead}${d.mode === 'llm' ? ' + LLM' : ''})</button>` : '';
  const gaps = d.gaps || [];
  return `<div class="card" id="gapsCard">
    ${sectionHead('Content gaps', sub, btn)}
    ${d.modeNote ? `<div class="section-sub">Without an LLM: more noise and misses, especially outside English and Russian.</div>` : ''}
    ${gaps.length ? `<ul class="digest-list">${gaps.map(gapItemHtml).join('')}</ul>`
      : empty(notRead ? 'comments of top videos have not been read yet — press the button above'
        : 'no questions without a video were found in the comments')}
    ${d.coveredCount ? `<div class="section-sub">Already covered by videos in the database: ${d.coveredCount}.</div>` : ''}
    ${other.length ? `<div class="section-sub">Skipped videos: ${other.map((s) =>
      `“${esc(s.title || s.videoId)}” — ${esc(GAP_SKIP[s.reason] || s.reason)}`).join('; ')}</div>` : ''}
    <div class="section-sub">A gap is only as real as the database is complete: coverage is checked only against what is collected here.
      ${d.quotaSpent ? ` Quota spent: ${d.quotaSpent}.` : ''}</div>
  </div>`;
}

function wireGaps() {
  const btn = $('#gapsFetch');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Reading comments…';
    try {
      const d = await api(`/api/niches/${encodeURIComponent(btn.dataset.slug)}/content-gaps`,
        { method: 'POST', body: {} });
      $('#gapsCard').outerHTML = gapsBlock(d, btn.dataset.slug);
      wireGaps();
      toast(`Done, quota spent: ${d.quotaSpent || 0}`, 'ok');
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Retry';
      toast(e.message, 'err');
    }
  });
}

/* Thumbnail styles (plan 13): k-means over the CLIP vectors of a niche's thumbnails and how each
   style performs; thumbnail search by description. Vectors are computed by the worker
   (WORKER_THUMB_EMBED) or the button here -- thumbnails are downloaded from i.ytimg.com. */
function thumbCard(e, sub) {
  return `<article class="vcard">
    <a class="thumb" href="https://www.youtube.com/watch?v=${esc(e.videoId)}" target="_blank" rel="noopener">
      ${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb-fallback">no thumbnail</div>'}</a>
    <div class="vcard-title">${esc(e.title || e.videoId)}</div>
    <div class="vcard-meta">${sub}</div>
  </article>`;
}

function thumbStylesBlock(d, slug) {
  if (!d) return '';
  const head = sectionHead('Thumbnail styles', 'the niche\'s thumbnails similar by picture, grouped, and how each group performs',
    `<input type="text" id="thumbQuery" placeholder="find thumbnails: red arrow, shocked face" style="width:260px">`);
  const embedBtn = `<button class="btn btn-ghost btn-sm" id="thumbEmbed" data-slug="${esc(slug)}" type="button">
    Compute the niche's thumbnail vectors (up to 100, no quota spent)</button>`;
  const body = d.found
    ? d.styles.map((s) => `<div style="margin-bottom:14px">
        <div class="row-sub"><b>Style ${s.style}</b> · ${num(s.videos)} videos (${Math.round(s.share * 100)}%)
          · median multiplier ${s.medianOutlierScore != null ? mult(s.medianOutlierScore) : '—'}
          · median views ${compact(s.medianViews)}</div>
        <div class="cards">${s.examples.map((e) => thumbCard(e,
          `${compact(e.views)} views${e.outlierScore != null ? ` · ${mult(e.outlierScore)}` : ''}`)).join('')}</div>
      </div>`).join('')
      + `<div class="section-sub">Groups are a similar look of thumbnails, not a rule. The median multiplier is a link, not a cause.
          CLIP compares the style and content of the picture, not the text on it.</div>`
    : `${empty(`vectors exist for ${num(d.embedded)} of ${num(d.videos)} thumbnails, at least 12 are needed`)}${embedBtn}`;
  return `<div class="card" id="thumbStylesCard">${head}<div id="thumbSearchOut"></div>${body}</div>`;
}

function wireThumbStyles(slug) {
  const input = $('#thumbQuery');
  if (input) input.addEventListener('change', async () => {
    const out = $('#thumbSearchOut');
    const query = input.value.trim();
    if (!query) { out.innerHTML = ''; return; }
    out.innerHTML = empty('Searching… (the first search downloads the text model, ~0.25 GB)');
    try {
      const r = await api(`/api/thumbnails/search${q({ q: query, niche: slug, limit: 8 })}`);
      out.innerHTML = r.results.length
        ? `<div class="cards" style="margin-bottom:14px">${r.results.map((e) => thumbCard(e,
            `similarity ${Math.round(e.similarity * 100)}% · ${compact(e.views)} views`)).join('')}</div>`
        : empty(r.hint || 'nothing similar');
    } catch (e) { out.innerHTML = notice(esc(e.message)); }
  });
  const btn = $('#thumbEmbed');
  if (btn) btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Calculating… (about a second per thumbnail)';
    try {
      const r = await api(`/api/thumbnails/embed${q({ limit: 100, niche: btn.dataset.slug })}`, { method: 'POST' });
      toast(`Done: ${r.embedded} vectors, ${r.failed} not read`, 'ok');
      const d = await api(`/api/niches/${encodeURIComponent(slug)}/thumbnail-styles`);
      $('#thumbStylesCard').outerHTML = thumbStylesBlock(d, slug);
      wireThumbStyles(slug);
    } catch (e) { btn.disabled = false; btn.textContent = 'Retry'; toast(e.message, 'err'); }
  });
}

function nicheVideoTagsSection(videos, tagsByVideo, tagGroup, nicheSlug) {
  if (!videos.length) return '';
  return `
    <div class="card">
      ${sectionHead('Niche videos', `tags of group “${esc(tagGroup)}” — edited manually`,
        `<button class="btn btn-ghost btn-sm" id="nicheInsightsBtn" data-slug="${esc(nicheSlug)}">
           Niche insights from cache</button>`)}
      <div id="nicheInsightsPanel" hidden style="margin-bottom:12px"></div>
      <div class="rows">${videos.map((v) => `
        <div class="row" data-video-id="${esc(v.videoId)}" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;width:100%;align-items:flex-start;gap:12px">
            <div class="row-main">
              <div class="row-title">
                <a href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">${esc(v.title)}</a>
              </div>
              <div class="row-sub">${compact(v.views)} views · ${mult(v.outlierScore)}</div>
              <div class="tag-editor" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">
                ${(tagsByVideo[v.videoId] || []).map((t) => `
                  <span class="chip tag-chip" data-tag="${esc(t)}">${esc(t)}
                    <a href="#" class="tag-remove" data-tag="${esc(t)}" title="remove tag">×</a>
                  </span>`).join('')}
                <input type="text" class="tag-add-input" placeholder="+ tag" style="width:100px">
              </div>
            </div>
            <button class="btn btn-ghost btn-sm insights-btn" data-insights-video-id="${esc(v.videoId)}">Comment insights</button>
          </div>
          <div class="insights-panel" data-insights-video-id="${esc(v.videoId)}" hidden style="width:100%"></div>
        </div>`).join('')}</div>
    </div>`;
}

function wireNicheTagEditor(slug, tagGroup) {
  const groupInput = $('#tagGroupInput');
  if (groupInput) {
    groupInput.addEventListener('change', () => {
      const g = groupInput.value.trim() || 'theme';
      localStorage.setItem('nf.tagGroup', g);
      render();
    });
  }
  const writeTags = async (videoId, tags) => {
    await api('/api/tags', { method: 'POST', body: {
      items: [{ video_id: videoId, tag_group: tagGroup, tags }],
      source: 'manual', replace: true,
    } });
    render();
  };
  view.querySelectorAll('[data-video-id]').forEach((rowEl) => {
    const videoId = rowEl.dataset.videoId;
    const current = () => [...rowEl.querySelectorAll('.tag-chip')].map((c) => c.dataset.tag);

    rowEl.querySelectorAll('.tag-remove').forEach((a) => a.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await writeTags(videoId, current().filter((t) => t !== a.dataset.tag)); }
      catch (err) { toast(err.message, 'err'); }
    }));

    const input = rowEl.querySelector('.tag-add-input');
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const tag = input.value.trim();
      if (!tag) return;
      try { await writeTags(videoId, [...current(), tag]); }
      catch (err) { toast(err.message, 'err'); }
    });
  });
}

/* LLM-proposed tags outside the niche taxonomy (stage 03) -- accept/reject
   via POST /api/tags/proposed/resolve. Not tied to the tagGroup selected
   in tagStatsSection: proposed tags can be in any group. */
function proposedTagsSection(proposed) {
  if (!proposed.length) return '';
  return `
    <div class="card">
      ${sectionHead('Proposed tags', 'the LLM proposed tags outside the niche taxonomy — confirm or reject')}
      <div class="rows">${proposed.map((p) => `
        <div class="row" data-proposed-video-id="${esc(p.videoId)}" data-tag-group="${esc(p.tagGroup)}" data-tag="${esc(p.tag)}">
          <div class="row-main">
            <div class="row-title">${esc(p.tag)} <span class="chip">${esc(p.tagGroup)}</span></div>
            <div class="row-sub">video <a href="https://www.youtube.com/watch?v=${esc(p.videoId)}"
              target="_blank" rel="noopener">${esc(p.videoId)}</a> · ${ago(p.createdAt)}</div>
          </div>
          <div class="row-metrics">
            <button class="btn btn-ghost btn-sm proposed-accept">accept</button>
            <button class="btn btn-ghost btn-sm proposed-reject">reject</button>
          </div>
        </div>`).join('')}</div>
    </div>`;
}

function wireProposedTags() {
  view.querySelectorAll('[data-proposed-video-id]').forEach((rowEl) => {
    const { proposedVideoId: videoId, tagGroup, tag } = rowEl.dataset;
    const resolve = async (accept) => {
      try {
        await api('/api/tags/proposed/resolve', { method: 'POST',
          body: { videoId, tagGroup, tag, accept } });
        toast(accept ? 'Tag accepted' : 'Tag rejected', 'ok');
        render();
      } catch (e) { toast(e.message, 'err'); }
    };
    rowEl.querySelector('.proposed-accept')?.addEventListener('click', () => resolve(true));
    rowEl.querySelector('.proposed-reject')?.addEventListener('click', () => resolve(false));
  });
}

/* stage 15: the scatter plot filters live in the tab's memory, like
   channelFilters in the tracker -- not important enough to survive
   a reload. */
let scatterFilters = { channels: '', includeShorts: true };

function scatterSection(videos, filters) {
  return `
    <div class="card">
      ${sectionHead('Views by publication date', 'colour — channel; hollow outline — younger than 30 days; large outline — anomaly', `
        <input type="text" id="scatterChannels" placeholder="channel IDs, comma-separated"
          value="${esc(filters.channels)}" style="width:220px">
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)">
          <input type="checkbox" id="scatterHideShorts" ${filters.includeShorts ? '' : 'checked'}> hide Shorts
        </label>`)}
      ${scatterChart(videos)}
    </div>`;
}

function wireScatterFilters(rerender) {
  const apply = () => {
    scatterFilters = {
      channels: $('#scatterChannels').value.trim(),
      includeShorts: !$('#scatterHideShorts').checked,
    };
    rerender();
  };
  $('#scatterChannels').addEventListener('change', apply);
  $('#scatterHideShorts').addEventListener('change', apply);
}

async function viewNiche(slug) {
  const tagGroup = localStorage.getItem('nf.tagGroup') || 'theme';
  const [d, stats, videoTags, proposed, scatter, risk, sponsors, gaps, thumbStyles] = await Promise.all([
    api(`/api/niches/${encodeURIComponent(slug)}${q({ period: state.period, top_n: 30 })}`),
    api(`/api/tags/stats${q({ niche: slug, tag_group: tagGroup })}`),
    api(`/api/tags${q({ niche: slug })}`),
    api(`/api/tags/proposed${q({ niche: slug })}`),
    api(`/api/niches/${encodeURIComponent(slug)}/videos${q({
      period: state.period, channels: scatterFilters.channels || undefined,
      include_shorts: scatterFilters.includeShorts,
    })}`),
    api(`/api/niches/${encodeURIComponent(slug)}/template-risk`).catch(() => null),
    // Not critical for the screen: the niche opens even without sponsors.
    api(`/api/niches/${encodeURIComponent(slug)}/sponsors${q({ period: state.period })}`)
      .catch(() => null),
    api(`/api/niches/${encodeURIComponent(slug)}/content-gaps`).catch(() => null),
    api(`/api/niches/${encodeURIComponent(slug)}/thumbnail-styles`).catch(() => null),
  ]);
  if (!d.found) { view.innerHTML = notice(esc(d.hint || 'niche not found')); return; }

  const tagsByVideo = {};
  for (const t of (videoTags.tags || [])) {
    if (t.tagGroup !== tagGroup) continue;
    (tagsByVideo[t.videoId] ||= []).push(t.tag);
  }

  view.innerHTML = nicheOverviewBlock(d,
    sectionHead(`Niche: ${slug}`, `${esc(d.query || '')} · ${plabel(state.period)}`, `
      <a class="btn btn-ghost btn-sm" href="/api/niche/${encodeURIComponent(slug)}/export.tsv">Export TSV</a>
      <a class="btn btn-ghost btn-sm" href="/api/niche/${encodeURIComponent(slug)}/export.csv">Export CSV</a>`))
    + nicheTemplateRiskBlock(risk)
    + '<div id="nichePolicy"></div>'
    + '<div id="nicheTraits"></div>'
    + '<div id="nicheProfit"></div>'
    + scatterSection(scatter.videos || [], scatterFilters)
    + sponsorBlock(sponsors, 'Niche sponsors', plabel(state.period))
    + gapsBlock(gaps, slug)
    + thumbStylesBlock(thumbStyles, slug)
    + tagStatsSection(stats, tagGroup)
    + nicheVideoTagsSection(d.top_videos_by_outlier_score || [], tagsByVideo, tagGroup, slug)
    + proposedTagsSection(proposed.proposed || []);

  wireNicheTagEditor(slug, tagGroup);
  wireProposedTags();
  wireScatterFilters(() => viewNiche(slug));
  wireCommentInsights();
  wireGaps();
  wireThumbStyles(slug);
  // plan 22: computed over all the niche's channels -- a separate request, the screen does not wait
  api(`/api/niches/${encodeURIComponent(slug)}/policy-signals`)
    .then((r) => { const box = $('#nichePolicy'); if (box) box.innerHTML = nichePolicyBlock(r); })
    .catch(() => {});
  // plan 30: profit of a typical niche video and of a month of such videos
  mountProfit($('#nicheProfit'), { niche: slug });
  // plan 29: what breakouts have in common -- by the numbers, a separate request
  api(`/api/niches/${encodeURIComponent(slug)}/outlier-traits`)
    .then((r) => { const box = $('#nicheTraits'); if (box) box.innerHTML = outlierTraitsBlock(r); })
    .catch(() => {});
}

export { viewNiche };
