/* Shared by screens: the #view container, period labels, the collect form, the footer
   with quota, the niche overview and redrawing the current screen. */
import { $, api, num, compact, mult, esc, toast, tile, sectionHead, barList, table, state, saturationBlock } from './ui.js';

/* render() lives in router.js, but screens redraw themselves through it after
   actions. A direct import would create a router -> screens -> router cycle, so
   the router registers its function here at load time (setRender). */
let renderImpl = null;
function setRender(fn) { renderImpl = fn; }
function render() { return renderImpl(); }

const view = $('#view');

const PERIOD_LABEL = {
  '1h': 'last hour', '6h': 'last 6 hours', '24h': 'last 24 hours', '48h': 'last 48 hours',
  '7d': 'last 7 days', '14d': 'last 14 days', '30d': 'last 30 days', '60d': 'last 60 days',
  '90d': 'last 90 days', '180d': 'last 180 days', '365d': 'last year', all: 'all time',
};
const plabel = (p) => PERIOD_LABEL[p] || `last ${p}`;

const SATURATION = {
  'dominated by big channels -- hard to break in': 'dominated by big channels — hard to break in',
  'plenty of small channels performing -- room to enter': 'many small channels are breaking out — room to enter',
  'mixed field': 'mixed field',
};

function base() { return { period: state.period, niche: state.niche }; }

/* The collect form is reused on several screens. */
function collectForm() {
  return `<div class="card">
    ${sectionHead('Add data', 'collecting spends YouTube quota; a channel ≈ 1 unit per 50 videos')}
    <div class="form-row">
      <label class="field"><span class="field-label">Channel: @handle, UC-id or URL</span>
        <input type="text" id="collectChannel" placeholder="@Inkexplainer96"></label>
      <label class="field"><span class="field-label">Niche (optional)</span>
        <input type="text" id="collectNiche" placeholder="explainer"></label>
      <button class="btn" id="collectBtn" type="button">Collect channel</button>
      <button class="btn btn-ghost" id="collectTrackBtn" type="button">Collect and track</button>
    </div>
    <div class="form-row" style="margin-top:12px">
      <label class="field"><span class="field-label">Search query (1 of 100 searches per day)</span>
        <input type="text" id="collectQuery" placeholder="ai automation"></label>
      <label class="field"><span class="field-label">Publication window</span>
        <select id="collectPeriod"><option value="">any</option><option value="24h">24 hours</option>
        <option value="7d">7 days</option><option value="30d">30 days</option></select></label>
      <button class="btn btn-ghost" id="searchBtn" type="button">Collect by search</button>
    </div>
  </div>`;
}

function wireCollect(refresh) {
  for (const id of ['collectBtn', 'collectTrackBtn', 'searchBtn']) {
    const b = $(`#${id}`);
    if (b) b.dataset.label = b.textContent;
  }
  const busy = (btn, on) => { btn.disabled = on; btn.textContent = on ? 'Collecting…' : btn.dataset.label; };
  const run = async (btn, path, body, ok) => {
    busy(btn, true);
    try {
      const r = await api(path, { method: 'POST', body });
      toast(ok(r), 'ok');
      await Promise.all([refresh(), loadFootStat()]);
    } catch (e) { toast(e.message, 'err'); } finally { busy(btn, false); }
  };
  $('#collectBtn')?.addEventListener('click', () => {
    const ch = $('#collectChannel').value.trim();
    if (!ch) return toast('Enter a channel', 'err');
    run($('#collectBtn'), '/api/collect/channel',
      { channel: ch, niche: $('#collectNiche').value.trim() || null },
      (r) => `${r.channelTitle}: saved ${r.videos_stored} videos, ${r.quota.units_from_shared_pool} units`);
  });
  $('#collectTrackBtn')?.addEventListener('click', () => {
    const ch = $('#collectChannel').value.trim();
    if (!ch) return toast('Enter a channel', 'err');
    run($('#collectTrackBtn'), '/api/collect/channel',
      { channel: ch, niche: $('#collectNiche').value.trim() || null, track: true },
      (r) => `${r.channelTitle} added to the tracker, ${r.videos_stored} videos`);
  });
  $('#searchBtn')?.addEventListener('click', () => {
    const query = $('#collectQuery').value.trim();
    if (!query) return toast('Enter a query', 'err');
    run($('#searchBtn'), '/api/collect/niche',
      { query, period: $('#collectPeriod').value || null },
      (r) => `«${r.query}»: ${r.videos_stored ?? 0} videos, ${r.quota.search_calls} search spent`);
  });
}

/* Shared tiles + charts for the niche overview -- used both by slug
   (viewNiche) and from a channel (niche_overview_from_channel in viewChannel).
   `head` -- a ready-made sectionHead(...) for the top card. */
function nicheOverviewBlock(d, head) {
  return `
    <div class="card">
      ${head}
      <div class="tiles">
        ${tile('Videos', num(d.video_count))}
        ${tile('Channels', num(d.channel_count))}
        ${tile('Median multiplier', mult(d.median_outlier_score))}
        ${tile('Median views', compact(d.median_views_per_video))}
        ${tile('Viral skew', d.viral_skew ?? '—', 'mean / median')}
        ${tile('Shorts', `${d.shorts_share_percent}%`)}
        ${tile('Small-channel breakouts', num(d.small_channel_breakouts), '≤10k subs, VSR ≥ 5')}
      </div>
    </div>
    ${saturationBlock(d.saturation_v2)}
    <div class="grid-2">
      <div class="card">
        ${sectionHead('Channels by size', SATURATION[d.saturation_hint] || d.saturation_hint)}
        ${barList(Object.entries(d.channel_size_distribution).map(([k, v]) => ({ name: k, value: v, display: num(v) })))}
      </div>
      <div class="card">
        ${sectionHead('Top by multiplier')}
        ${table([
          { label: 'Video', wrap: true, render: (r) => esc(r.title) },
          { label: 'Views', num: true, render: (r) => compact(r.views) },
          { label: 'Multiplier', num: true, render: (r) => mult(r.outlierScore) },
          { label: 'VSR', num: true, render: (r) => (+r.viewsPerSubscriber).toFixed(1) },
        ], d.top_videos_by_outlier_score)}
      </div>
    </div>`;
}
async function loadFootStat() {
  try {
    const h = await api('/api/health');
    const sq = h.searchQuota;
    const uq = h.unitQuota;
    $('#footStat').innerHTML =
      `${num(h.db.channels)} channels · ${num(h.db.videos)} videos<br>` +
      (h.historyAvailable ? 'history is being recorded' : 'no history — start the worker') +
      (sq ? `<br>Search: ${sq.callsLeft}/${sq.dailyLimit} left today` : '') +
      (uq ? `<br>API quota: ${num(uq.unitsLeft)}/${num(uq.dailyLimit)} units left` : '');
    $('#brandTag').textContent = h.hasApiKey ? 'local' : 'no key';
  } catch { $('#footStat').textContent = 'service unavailable'; }
}

export { view, plabel, base, collectForm, wireCollect, loadFootStat, nicheOverviewBlock, render, setRender };
