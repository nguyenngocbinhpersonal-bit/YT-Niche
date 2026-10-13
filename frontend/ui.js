/* niche-finder dashboard — vanilla ES modules, no build step.
   Every screen reads the same functions as the MCP tools, via backend/api.py. */

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  period: localStorage.getItem('nf.period') || '30d',
  niche: localStorage.getItem('nf.niche') || '',
  route: 'overview',
};

/* ------------------------------------------------------------------ api */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty response */ }
  if (res.status === 401 && path !== '/api/auth/login') {
    // Plan 15: the session has ended or is missing -- app.js will show the sign-in screen.
    dispatchEvent(new CustomEvent('nf:signin-required'));
  }
  if (!res.ok) {
    const msg = data?.detail || data?.error || `HTTP ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

function q(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/* ------------------------------------------------------------ formatters */

const nf = new Intl.NumberFormat('en-US');

function num(n) { return n === null || n === undefined ? '—' : nf.format(Math.round(n)); }

function compact(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.0', '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.0', '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.0', '') + 'K';
  return String(Math.round(n));
}

/* English plurals: "1 channel", "3 channels". */
function plural(n, one, many) {
  return Math.abs(Math.round(n)) === 1 ? one : many;
}

function pl(n, one, many) { return `${num(n)} ${plural(n, one, many)}`; }

/* RPM range (plan 06): an estimate with no verifiable source, so always a range. */
function usd(x) { return x == null ? '—' : x >= 10 ? String(Math.round(x)) : (+x).toFixed(1).replace('.0', ''); }
function rpmRange(r) { return r ? `$${usd(r.low)}–${usd(r.high)}` : '—'; }
const RPM_TIP = 'RPM estimate by category, not a measured payout: the midpoint is the niche model, '
  + 'range ÷2…×2 because public estimates for one niche differ by up to 7x';

/* Template risk (plan 01): a heuristic over uploads, not a YouTube verdict. */
const RISK_LEVEL = { low: ['low', ''], medium: ['medium', 'chip-warn'], high: ['high', 'chip-bad'],
                     'insufficient-data': ['not enough data', ''] };
const RISK_REASON = {
  similarity: (v) => `titles are very similar to each other (similarity ${(+v).toFixed(2)})`,
  templateShare: (v) => `${Math.round(v * 100)}% of titles repeat the same opening or ending`,
  durationCv: (v) => `video duration barely changes (spread ${(+v).toFixed(2)})`,
  cadenceCv: (v) => `videos come out on an even rhythm (interval spread ${(+v).toFixed(2)})`,
};
const RISK_NOTE = 'A heuristic over public upload patterns, not a YouTube decision: series, podcasts '
  + 'and music channels can also score high.';

function riskChip(level) {
  const [label, cls] = RISK_LEVEL[level] || RISK_LEVEL['insufficient-data'];
  return `<span class="chip ${cls}">${label}</span>`;
}

function templateRiskBlock(r) {
  if (!r || !r.found) return '';
  const head = sectionHead('Template risk', 'how closely recent uploads follow one repeatable template', qmark('templateRisk'));
  if (r.level === 'insufficient-data') {
    return `<div class="card">${head}<div class="section-sub">Not enough data: at least 10 recent
      videos with embeddings are needed, currently ${num(r.videosAnalysed)}.</div></div>`;
  }
  return `<div class="card">${head}
    <div class="tiles">
      ${tile('Score', `${r.score}<span class="tile-unit"> / 100</span>`, riskChip(r.level))}
      ${tile('Videos scored', num(r.videosAnalysed), r.format === 'long-form' ? 'excluding Shorts' : 'all formats')}
    </div>
    ${r.reasons.length ? `<ul class="digest-list">${r.reasons.map((x) =>
      `<li style="white-space:normal">${esc((RISK_REASON[x.signal] || (() => x.text))(x.value))}</li>`).join('')}</ul>`
      : '<div class="section-sub" style="margin-top:8px">No template signal stands out.</div>'}
    <div class="section-sub" style="margin-top:8px">${RISK_NOTE}</div></div>`;
}

/* Plan 22: signals for the three "inauthentic" content categories from the
   YouTube monetization rules. Levels, reasons and the rule text -- no overall "risk
   percentage": YouTube decides, manually. */
const POLICY_CAT = {
  generic_repetitive: 'Templated, repetitive content',
  unsatisfying: 'Shock and emotional manipulation',
  ai_persona_sensitive: 'AI persona on a sensitive topic',
};
const POLICY_LEVEL = { high: ['chip-bad', 'clear signals'], watch: ['', 'worth watching'],
  none: ['chip-good', 'no signals'], 'insufficient-data': ['', 'not enough data'] };
/* A paraphrase of the YouTube rules; the original is behind the "YouTube help" link. */
const POLICY_TEXT = {
  generic_repetitive: 'videos that look interchangeable; made from a stock or unoriginal template',
  unsatisfying: 'content that relies on emotional manipulation or is made for shock',
  ai_persona_sensitive: 'AI personas that give health, legal, financial or political advice as experts',
};
const POLICY_TOPIC = { health: 'health', legal: 'law', finance: 'finance', politics: 'politics' };
const POLICY_REASON = {
  thumbSimilarity: (x) => `thumbnails look alike (similarity ${(+x.value).toFixed(2)})`,
  shockShare: (x) => `${Math.round(x.value * 100)}% of recent titles with shock markers`,
  sensitiveShare: (x) => `${Math.round(x.value * 100)}% of recent videos about ${POLICY_TOPIC[x.topic] || x.topic}`,
  syntheticShare: (x) => `${Math.round(x.value * 100)}% of videos with disclosed AI content`,
  faceless: () => 'channel is labelled faceless',
};
function policyReason(x) {
  if (POLICY_REASON[x.signal]) return POLICY_REASON[x.signal](x);
  if (RISK_REASON[x.signal]) return RISK_REASON[x.signal](x.value);
  return x.text || '';
}
const POLICY_NOTE = 'These are signals visible in public data, not a YouTube decision: people review monetization. '
  + 'An AI persona cannot be seen in public data, so this category never rises above "worth watching".';

function policyBlock(r) {
  if (!r || !r.found) return '';
  const rows = Object.entries(r.categories).map(([k, c]) => {
    const [cls, label] = POLICY_LEVEL[c.level] || ['', c.level];
    return `<div class="row"><div class="row-main">
      <div class="row-title">${esc(POLICY_CAT[k] || k)} <span class="chip ${cls}">${esc(label)}</span></div>
      <div class="row-sub">${c.reasons.length ? esc(c.reasons.map(policyReason).join('; ')) : ''}${
        c.examples.length && c.level !== 'none' ? `${c.reasons.length ? ' · ' : ''}for example: “${esc(c.examples[0])}”` : ''}</div>
      <div class="row-sub">Rule: ${esc(POLICY_TEXT[k] || c.policy)} · <a href="${esc(c.policyUrl)}" target="_blank" rel="noopener">YouTube help</a></div>
    </div></div>`;
  }).join('');
  return `<div class="card">${sectionHead('Monetization-policy signals', 'three categories of YouTube "inauthentic" content', qmark('policySignals'))}
    <div class="rows">${rows}</div><div class="section-sub" style="margin-top:8px">${esc(POLICY_NOTE)}</div></div>`;
}

function nichePolicyBlock(n) {
  if (!n || !n.found) return '';
  return `<div class="card">${sectionHead('Monetization-policy signals in the niche', 'how many niche channels show signals in each category', qmark('policySignals'))}
    ${table([
      { label: 'Category', wrap: true, render: (r) => esc(POLICY_CAT[r.key] || r.key) },
      { label: 'Clear', num: true, render: (r) => num(r.high) },
      { label: 'Watch', num: true, render: (r) => num(r.watch) },
      { label: 'Share', num: true, render: (r) => (r.shareFlagged == null ? '—' : `${Math.round(r.shareFlagged * 100)}%`) },
      { label: 'Channels', wrap: true, render: (r) => r.channels.map((c) =>
        `<a href="#/channel/${esc(c.channelId)}">${esc(c.channelTitle || c.channelId)}</a>`).join(', ') || '—' },
    ], Object.entries(n.categories).map(([key, c]) => ({ key, ...c })))}
    <div class="section-sub" style="margin-top:8px">${esc(POLICY_NOTE)}</div></div>`;
}

function nicheTemplateRiskBlock(n) {
  if (!n || !n.found) return '';
  const head = sectionHead('Template risk of niche channels',
    'what share of channels look like an assembly line — where there are many, copying the format is risky');
  if (!n.channelsAnalysed) {
    return `<div class="card">${head}<div class="section-sub">Not enough data: no channel has 10+ recent videos.</div></div>`;
  }
  return `<div class="card">${head}
    <div class="tiles">
      ${tile('High risk', `${n.highRiskSharePercent}%`, `${num(n.levels.high)} of ${num(n.channelsAnalysed)} channels`)}
      ${tile('Medium', num(n.levels.medium))}
      ${tile('Low', num(n.levels.low))}
      ${tile('Not enough data', num(n.channelsInsufficient), 'fewer than 10 videos')}
    </div>
    ${table([
      { label: 'Most templated channels', wrap: true, render: (c) => `<a href="#/channel/${esc(c.channelId)}">${esc(c.title || c.channelId)}</a>` },
      { label: 'Subscribers', num: true, render: (c) => compact(c.subscribers) },
      { label: 'Score', num: true, render: (c) => num(c.score) },
      { label: 'Risk', render: (c) => riskChip(c.level) },
    ], n.mostTemplated)}
    <div class="section-sub" style="margin-top:8px">${RISK_NOTE}</div></div>`;
}

function mult(x) { return x === null || x === undefined ? '—' : `${(+x).toFixed(1)}x`; }

function ago(iso) {
  if (!iso) return '—';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (!isFinite(h)) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 45) return `${Math.round(d)} d ago`;
  if (d < 365) return `${Math.round(d / 30)} mo ago`;
  const y = d / 365;
  return `${y.toFixed(y < 2 ? 1 : 0)} y ago`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* A delta always carries a sign and a word — colour is never the only carrier of meaning. */
function delta(v, unit = '%') {
  if (v === null || v === undefined) return '<span class="chip">no data</span>';
  const up = v > 0, flat = Math.abs(v) < 0.05;
  const cls = flat ? '' : up ? 'chip-good' : 'chip-bad';
  const sign = flat ? '' : up ? '▲ +' : '▼ ';
  return `<span class="chip ${cls}">${sign}${(+v).toFixed(1)}${unit}</span>`;
}

/* --------------------------------------------------------------- tooltip */

const tip = $('#tooltip');

/* data-tip is an attribute: the browser decodes &lt; back to "<", and a video title
   like <img onerror=…> would become markup. So everything is escaped again and
   only <br> and <b>, which the tips use for formatting, are allowed. */
function safeTip(text) {
  return esc(text).replace(/&lt;(\/?)(br|b)\s*\/?&gt;/g, '<$1$2>');
}

function showTip(evt, html) {
  tip.innerHTML = safeTip(html);
  tip.hidden = false;
  const pad = 12, r = tip.getBoundingClientRect();
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
function hideTip() { tip.hidden = true; }

/* Delegation: any element with data-tip gets a hover tooltip. */
document.addEventListener('mousemove', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el) showTip(e, el.dataset.tip); else hideTip();
});
document.addEventListener('mouseleave', hideTip);
document.addEventListener('scroll', hideTip, true);

/* Plan 20: "compare" on a video card -- adds to the compare basket and opens its screen. */
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-compare]');
  if (!el) return;
  e.preventDefault();
  location.hash = compareHref(el.dataset.compare);
});

/* ---------------------------------------------------------------- toasts */

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 9000 : 4500);
}

/* ------------------------------------------------------------ components */

function tile(label, value, note) {
  return `<div class="tile">
    <div class="tile-label">${esc(label)}</div>
    <div class="tile-value">${value}</div>
    ${note ? `<div class="tile-note">${note}</div>` : ''}
  </div>`;
}

function sectionHead(title, sub, actions = '') {
  return `<div class="section-head">
    <div><div class="section-title">${esc(title)}</div>
    ${sub ? `<div class="section-sub">${esc(sub)}</div>` : ''}</div>
    ${actions ? `<div class="section-actions">${actions}</div>` : ''}
  </div>`;
}

function notice(text, kind = '') {
  return `<div class="notice ${kind}">${text}</div>`;
}

function empty(text) { return `<div class="empty">${esc(text)}</div>`; }

/* Horizontal bars -- a single series, so no legend: the title names it. */
function barList(items) {
  if (!items.length) return empty('no data');
  const max = Math.max(...items.map((i) => i.value || 0), 1);
  return `<div class="barlist">${items.map((i) => `
    <div class="barrow" data-tip="${esc(i.tip || `${i.name}: ${num(i.value)}`)}">
      <div class="barrow-name">${esc(i.name)}</div>
      <div class="barrow-value">${esc(i.display ?? num(i.value))}</div>
      <div class="bartrack"><div class="barfill" style="width:${Math.max(2, (i.value / max) * 100)}%"></div></div>
    </div>`).join('')}</div>`;
}

function strengthBar(level) {
  return `<div class="strength">${[0, 1, 2, 3]
    .map((i) => `<i class="${i < (level || 0) ? 'on' : ''}"></i>`).join('')}</div>`;
}

function channelRow(c) {
  const subs = c.subscribers === null ? 'subscribers hidden' : `${compact(c.subscribers)} subscribers`;
  return `<div class="row">
    <div class="avatar">${esc((c.channelTitle || '?').slice(0, 1).toUpperCase())}</div>
    <div class="row-main">
      <div class="row-title"><a href="#/channel/${esc(c.channelId)}">${esc(c.channelTitle || c.channelId)}</a></div>
      <div class="row-sub">${subs}${c.category ? ` · ${esc(c.category)}` : ''}${
        c.videosInWindow ? ` · ${c.videosInWindow} videos in window` : ''}</div>
    </div>
    <div class="row-metrics">
      <div class="metric" data-tip="${c.multiplierBasis === 'lifetime-mean'
        ? 'Computed against the channel\'s lifetime MEAN (NexLev formula).&lt;br&gt;Too few of its videos in the database for a median baseline — 4+ are needed.&lt;br&gt;Such a number is inflated by one viral video: collect the whole channel.'
        : 'Best age-normalised multiplier among the channel\'s videos in the window.&lt;br&gt;Computed against the median of the same channel\'s previous uploads.'}">
        <div class="metric-value">${mult(c.multiplier)}${
          c.multiplierBasis === 'lifetime-mean' ? '<span class="approx">≈</span>' : ''}</div>
        ${strengthBar(c.strength)}
      </div>
    </div>
  </div>`;
}

function videoCard(v) {
  const thumb = v.thumbnail
    ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">`
    : `<div class="thumb-fallback">no thumbnail</div>`;
  const vph = v.vph24h ?? v.vphLifetime;
  const vphLabel = v.vph24h != null ? 'VPH, 24h' : 'VPH, all time';
  return `<article class="vcard">
    <a class="thumb" href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">
      ${thumb}
      ${vph != null ? `<span class="badge" data-tip="${scoreTip('vph', vphLabel)}">${num(vph)} VPH</span>` : ''}
      ${v.outlierScore != null ? `<span class="badge badge-right" data-tip="${scoreTip('outlierScore')}">${mult(v.outlierScore)}</span>` : ''}
    </a>
    <div class="vcard-title">${esc(v.title)}</div>
    <div class="vcard-meta">${compact(v.views)} views · ${ago(v.publishedAt)}
      · <a href="#/brief/${esc(v.videoId)}" data-tip="Build a brief for your own video from this outlier">brief</a>
      · <a href="#" data-compare="${esc(v.videoId)}" data-tip="Compare the view trajectory with other videos (up to 5)">compare</a></div>
    <div class="vcard-meta"><a href="#/channel/${esc(v.channelId)}">${esc(v.channelTitle || '')}</a>
      · ${compact(v.channelSubscribers)} subs</div>
    <div class="vcard-chips">
      <span class="chip chip-accent est" data-tip="${scoreTip('vsr')}">VSR ${(+v.viewsPerSubscriber).toFixed(1)}</span>
      ${v.outlierBand ? `<span class="chip">${esc(v.outlierBand)}</span>` : ''}
      ${v.estimatedRpmRange ? `<span class="chip" data-tip="${RPM_TIP}">~${rpmRange(v.estimatedRpmRange)} RPM</span>`
        : v.estimatedRpm != null ? `<span class="chip" data-tip="${RPM_TIP}">~$${v.estimatedRpm} RPM</span>` : ''}
      ${v.acceleration != null ? `<span class="chip ${v.acceleration > 1.2 ? 'chip-good' : v.acceleration < 0.8 ? 'chip-bad' : ''}"
        data-tip="${scoreTip('acceleration')}">${v.acceleration > 1.2 ? '▲' : v.acceleration < 0.8 ? '▼' : '='} ${v.acceleration}</span>` : ''}
    </div>
  </article>`;
}

/* Channel AI-label badge (stage 03) -- "faceless · voiceover_stock".
   Empty if the channel is not labelled yet (aiLabels missing/null). */
function aiLabelsBadge(ai) {
  if (!ai || !ai.contentFormat) return '';
  const parts = [ai.isFaceless ? 'faceless' : 'on-camera', ai.contentFormat];
  const tip = `AI labels${ai.topic ? ` · topic: ${ai.topic}` : ''}${ai.labeledAt ? ` · ${ago(ai.labeledAt)}` : ''}`;
  return `<span class="chip" data-tip="${esc(tip)}">${esc(parts.join(' · '))}</span>`;
}

function commentList(comments) {
  if (!comments.length) return empty('no comments');
  return `<div class="comments-list">${comments.map((c) => `
    <div class="comment-row">
      <div class="comment-meta">${esc(c.author || '—')} · ${ago(c.publishedAt)} · 👍 ${num(c.likeCount || 0)}</div>
      <div class="comment-text">${esc(c.text || '')}</div>
    </div>`).join('')}</div>`;
}

function table(cols, rows) {
  if (!rows.length) return empty('no data');
  return `<div class="table-wrap"><table>
    <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}${c.tip ? ` ${qmark(c.tip)}` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => {
      const v = c.render ? c.render(r) : r[c.key];
      return `<td class="${c.num ? 'num' : ''}${c.wrap ? ' wrap' : ''}">${v ?? '—'}</td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

/* From 24.08.2026 YouTube counts a view from the first frame (plan 18): snapshots
   on either side of that date were counted under different rules. */
const VIEW_COUNT_CHANGE = { t: '2026-08-24T00:00:00Z', label: 'YouTube changed view counting' };

/* Line chart with a crosshair -- a single series, so no legend.
   marks: [{t, label}] -- vertical date marks, drawn only inside the X axis. */
function lineChart(points, { height = 180, valueLabel = 'value', marks = [] } = {}) {
  if (!points || points.length < 2) return empty('at least two history points are needed');
  const W = 720, H = height, m = { t: 12, r: 14, b: 22, l: 48 };
  const xs = points.map((p) => new Date(p.t).getTime());
  const ys = points.map((p) => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.1 || Math.max(1, y1 * 0.05);
  const lo = Math.max(0, y0 - pad), hi = y1 + pad;
  const px = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const py = (v) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(xs[i]).toFixed(1)},${py(p.v).toFixed(1)}`).join('');
  const area = `${d}L${px(x1).toFixed(1)},${py(lo).toFixed(1)}L${px(x0).toFixed(1)},${py(lo).toFixed(1)}Z`;
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(valueLabel)} over time">
    ${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}"/>
      <text x="${m.l - 8}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end">${compact(t)}</text>`).join('')}
    <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    <path class="area" d="${area}"/>
    <path class="line" d="${d}"/>
    ${marks.map((mk) => ({ ...mk, x: new Date(mk.t).getTime() }))
      .filter((mk) => mk.x > x0 && mk.x < x1)
      .map((mk) => `<line class="mark" x1="${px(mk.x).toFixed(1)}" x2="${px(mk.x).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"
        data-tip="${esc(new Date(mk.x).toLocaleDateString('en-US'))}&lt;br&gt;${esc(mk.label)}"/>`).join('')}
    ${points.map((p, i) => `<circle class="dot" cx="${px(xs[i]).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="4"
      data-tip="${esc(new Date(p.t).toLocaleString('en-US'))}&lt;br&gt;&lt;b&gt;${num(p.v)}&lt;/b&gt; ${esc(valueLabel)}"/>`).join('')}
    <text x="${m.l}" y="${H - 6}">${esc(new Date(x0).toLocaleDateString('en-US'))}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(new Date(x1).toLocaleDateString('en-US'))}</text>
  </svg>`;
}

/* Plan 20: video trajectories -- views by age (hours since publication) from the
   worker's snapshots. Each video has its own colour; a dashed line of the same colour is the channel's expected curve
   (channel median × maturation curve). The X axis is age, not date: that way videos from different
   days are compared at the same age. Marks -- title/thumbnail changes. */
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const MARK_LABEL = { title: 'title changed', thumbnail: 'thumbnail changed',
  thumbnail_image: 'thumbnail changed', view_count_change: 'YouTube changed view counting' };

function ageLabel(h) {
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;
}

function trajectoryChart(videos, { height = 260 } = {}) {
  const withPts = (videos || []).filter((v) => v.points.length >= 2);
  if (!withPts.length) return empty('at least two snapshots are needed — the worker snapshots videos every 3 hours during the first week');
  const W = 720, H = height, m = { t: 12, r: 14, b: 26, l: 52 };
  const all = withPts.flatMap((v) => [...v.points, ...v.expected]);
  const x1 = Math.max(...withPts.flatMap((v) => v.points.map((p) => p.ageHours)), 1);
  const y1 = Math.max(...all.filter((p) => p.ageHours <= x1 * 1.05).map((p) => p.views), 1) * 1.08;
  const px = (h) => m.l + (Math.min(h, x1) / x1) * (W - m.l - m.r);
  const py = (v) => m.t + (1 - v / y1) * (H - m.t - m.b);
  const path = (pts) => pts.filter((p) => p.ageHours <= x1).map((p, i) =>
    `${i ? 'L' : 'M'}${px(p.ageHours).toFixed(1)},${py(p.views).toFixed(1)}`).join('');
  const ticks = [0, y1 / 2, y1];
  const xticks = [0, x1 / 2, x1];
  const series = withPts.map((v, i) => {
    const c = SERIES[i % SERIES.length];
    return `${v.expected.length ? `<path class="tline expected" d="${path(v.expected)}" style="stroke:${c}"/>` : ''}
      <path class="tline" d="${path(v.points)}" style="stroke:${c}"/>
      ${v.points.map((p) => `<circle class="tdot" cx="${px(p.ageHours).toFixed(1)}" cy="${py(p.views).toFixed(1)}" r="3"
        style="fill:${c}" data-tip="${esc(v.title || v.videoId)}&lt;br&gt;${esc(ageLabel(p.ageHours))}: &lt;b&gt;${num(p.views)}&lt;/b&gt; views"/>`).join('')}
      ${v.marks.filter((mk) => mk.ageHours >= 0 && mk.ageHours <= x1).map((mk) => `<line class="mark" x1="${px(mk.ageHours).toFixed(1)}"
        x2="${px(mk.ageHours).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" style="stroke:${c}"
        data-tip="${esc(v.title || v.videoId)}&lt;br&gt;${esc(ageLabel(mk.ageHours))}: ${esc(MARK_LABEL[mk.kind] || mk.kind)}"/>`).join('')}`;
  }).join('');
  const legend = withPts.map((v, i) => `<span><i style="background:${SERIES[i % SERIES.length]}"></i>${esc(v.title || v.videoId)}${
    v.observedFromHours > 24 ? ` · observed from ${esc(ageLabel(v.observedFromHours))}` : ''}</span>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="views by video age">
    ${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}"/>
      <text x="${m.l - 8}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end">${compact(t)}</text>`).join('')}
    <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    ${xticks.map((h, i) => `<text x="${px(h).toFixed(1)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][i]}">${esc(ageLabel(h))}</text>`).join('')}
    ${series}
  </svg>
  <div class="chart-legend">${legend}${withPts.some((v) => v.expected.length)
    ? '<span><i style="background:var(--muted)"></i>dashed line — channel expectation (estimate)</span>'
    : '<span>no channel expectation: fewer than 4 videos collected for the channel</span>'}</div>`;
}

/* Compare basket (plan 20): up to 5 videos in localStorage; the "compare" link
   opens #/compare with this video and those already in the basket. */
function compareHref(videoId) {
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem('nf.compare') || '[]'); } catch { ids = []; }
  ids = [...ids.filter((x) => x !== videoId), videoId].slice(-5);
  return `#/compare/${ids.map(encodeURIComponent).join(',')}`;
}

/* Plan 23: the score catalog -- what each number is: YouTube data or an estimate by
   niche-finder, its formula, and the sample size from which it means anything. Loaded once
   at startup (/api/scores); until it loads the hint is a fallback text. */
let SCORES = null;

async function loadScores() {
  try { SCORES = (await api('/api/scores')).scores; } catch { SCORES = {}; }
}

/* "?" next to a number: a hint from the catalog (what it is, YouTube data or an estimate). */
function qmark(key) {
  return `<span class="qmark" data-tip="${scoreTip(key)}" aria-label="how it is calculated">?</span>`;
}

function scoreTip(key, lead = '') {
  const e = SCORES?.[key];
  if (!e) return esc(lead);
  const src = e.source === 'youtube' ? 'YouTube data' : 'niche-finder estimate, not YouTube data';
  return [lead ? esc(lead) : '', `&lt;b&gt;${esc(e.name)}&lt;/b&gt; — ${esc(src)}`, esc(e.formula),
    e.minSample ? `needed: ${esc(e.minSample)}` : ''].filter(Boolean).join('&lt;br&gt;');
}

/* A stable colour per channelId -- the same channel has the same colour everywhere
   without a palette/legend (a scatter can have dozens of them). */
function _channelColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 65% 55%)`;
}

/* Niche scatter plot (stage 15): X is the publication date, Y is views (log
   scale, otherwise one viral video flattens everything else into a line).
   Hollow dots are younger than 30 days (just grew, too early to compare). A large
   outline marks an anomaly by periodScore (or rolling if there is no period). Own SVG,
   no third-party chart libraries -- the same viewBox technique as lineChart:
   the width stretches to the container via CSS (.chart{width:100%}), no JS on
   resize. */
function scatterChart(videos, { height = 340, outlierThreshold = 3 } = {}) {
  if (!videos.length) return empty('no videos in the niche for this period');
  const W = 720, H = height, m = { t: 12, r: 14, b: 26, l: 52 };

  const xs = videos.map((v) => new Date(v.publishedAt).getTime()).filter(Number.isFinite);
  if (!xs.length) return empty('videos have no publication dates');
  const x0 = Math.min(...xs), x1 = Math.max(Math.max(...xs), x0 + 86400000);
  const ys = videos.map((v) => Math.log10(Math.max(1, v.views || 0)));
  const y0 = Math.min(...ys), y1 = Math.max(Math.max(...ys), Math.min(...ys) + 1);
  const px = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const py = (logV) => m.t + (1 - (logV - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

  const points = videos.map((v) => {
    const t = new Date(v.publishedAt).getTime();
    const views = Math.max(1, v.views || 0);
    const score = v.outlierScorePeriod ?? v.outlierScoreRolling ?? v.outlierScore;
    const isNew = (v.ageDays ?? Infinity) < 30;
    const isOutlier = (score || 0) >= outlierThreshold;
    const color = _channelColor(v.channelId);
    const tip = `${esc(v.title)}&lt;br&gt;${esc(v.channelTitle || v.channelId)}&lt;br&gt;`
      + `${num(views)} views · outlier ${score != null ? mult(score) : '—'}&lt;br&gt;`
      + `${Math.round((v.durationSeconds || 0) / 60)} min${isNew ? ' · younger than 30 days' : ''}`;
    return { cx: px(t), cy: py(Math.log10(views)), color, isNew, isOutlier, tip };
  }).filter((p) => Number.isFinite(p.cx) && Number.isFinite(p.cy));

  const yTicks = [y0, (y0 + y1) / 2, y1];

  return `<svg class="chart chart-scatter" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Niche video views by publication date, logarithmic scale">
    ${yTicks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}"
        y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}"/>
      <text x="${m.l - 8}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end">${compact(10 ** t)}</text>`).join('')}
    <line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    ${points.map((p) => `<circle r="${p.isOutlier ? 6 : 4}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}"
        fill="${p.isNew ? 'none' : p.color}" stroke="${p.color}" stroke-width="${p.isNew ? 2 : 1}"
        opacity="${p.isOutlier ? 1 : 0.75}" data-tip="${p.tip}"/>`).join('')}
    <text x="${m.l}" y="${H - 6}">${esc(new Date(x0).toLocaleDateString('en-US'))}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(new Date(x1).toLocaleDateString('en-US'))}</text>
  </svg>`;
}

function funnelBlock(res) {
  if (!res.funnel) return '';
  const rows = res.funnel.map((f) =>
    `<div class="funnel-step"><span>${esc(f.step)}</span><b>${num(f.remaining)}</b></div>`).join('');
  return `<div class="card"><div class="section-sub">Filter funnel</div>
    <div class="funnel">${rows}</div>
    ${res.hint ? `<div style="margin-top:12px">${notice(esc(res.hint))}</div>` : ''}</div>`;
}

/* Sponsor map (plan 09) -- one block for a niche and a channel. Data from
   /api/niches/{slug}/sponsors and /api/channels/{id}/sponsors. Always labelled
   as a lower bound: only what is stated in the video description is visible. */
const SPONSOR_FLOOR = 'Lower bound: only what is stated in the video description. '
  + 'An integration the author only mentions in the video is not visible here.';

function sponsorBrandBars(brands) {
  return barList((brands || []).map((b) => ({
    name: b.brand, value: b.videos,
    display: `${num(b.videos)} ${plural(b.videos, 'video', 'videos')}`
      + (b.channels > 1 ? ` · ${num(b.channels)} ${plural(b.channels, 'channel', 'channels')}` : ''),
    tip: `${esc(b.brand)}: ${num(b.videos)} videos, ${num(b.channels)} ch.`
      + (b.lastSeen ? `<br>last seen: ${esc(String(b.lastSeen).slice(0, 10))}` : '')
      + (b.examples || []).slice(0, 2).map((e) =>
        `<br>· ${esc(String(e.title || e.videoId).slice(0, 60))}`).join(''),
  })));
}

function sponsorBlock(d, title, sub) {
  const head = sectionHead(title, sub);
  if (!d) return `<div class="card">${head}${empty('failed to load sponsor data')}</div>`;
  if (d.found === false) return `<div class="card">${head}${empty(d.hint || 'no data yet')}</div>`;
  if (!d.videos) return `<div class="card">${head}${empty('no videos in the selected window')}
    <div class="section-sub" style="margin-top:10px">${esc(SPONSOR_FLOOR)}</div></div>`;
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const cover = d.scanCoverage < 1
    ? notice(`Descriptions scanned for ${pct(d.scanCoverage)} of videos — the worker will read the rest `
      + 'on the next run of the sponsors step. Shares are computed over scanned videos.') : '';
  const brands = d.topBrands || [];
  const aff = d.affiliateBrands || [];
  return `<div class="card">${head}${cover}
    <div class="tiles">
      ${tile('Videos with a sponsor', pct(d.sponsorShare),
        `${num(d.videosWithSponsor)} of ${num(d.videos)}`)}
      ${tile('Views with a sponsor', compact(d.avgViewsWithSponsor),
        `mean · median ${compact(d.medianViewsWithSponsor)}`)}
      ${tile('Views without a sponsor', compact(d.avgViewsWithout),
        `mean · median ${compact(d.medianViewsWithout)}`)}
      ${tile('Affiliate links', pct(d.affiliateShare),
        `${num(d.videosWithAffiliate)} videos`)}
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div><div class="section-sub" style="margin-bottom:8px">Sponsor brands and promo codes</div>
        ${brands.length ? sponsorBrandBars(brands) : empty('no sponsors found in descriptions')}</div>
      <div><div class="section-sub" style="margin-bottom:8px">Affiliate links (not sponsorship)</div>
        ${aff.length ? sponsorBrandBars(aff) : empty('no affiliate links found')}</div>
    </div>
    <div class="section-sub" style="margin-top:12px">${esc(SPONSOR_FLOOR)}</div>
  </div>`;
}

/* Niche saturation trend (plan 08): the last 30 days against the 90 before them.
   Two points are a "was → now" in a change tile, not a chart. The status is
   a labelled badge, not a single colour. */
const SAT_STATUS = {
  growing: ['growing', 'chip-good'],
  stable: ['stable', ''],
  cooling: ['cooling', 'chip-warn'],
  saturated: ['saturated', 'chip-bad'],
  'insufficient-data': ['not enough data', ''],
};
const SAT_REASON = {
  'supply-up': 'more videos are published than before',
  'supply-down': 'fewer videos are published than before',
  'supply-flat': 'the same number of videos is published',
  'demand-up': 'views of new videos are higher than before',
  'demand-down': 'views of new videos are lower than before',
  'demand-flat': 'views of new videos are at the same level',
  'demand-unknown': 'nothing to compare views against',
  'entrants-up': 'more new channels appear',
  'entrants-down': 'fewer new channels appear',
  'entrants-flat': 'new channels appear at the same pace',
  'entrants-unknown': 'channel creation dates are unknown',
  'newcomers-break-out': 'newcomers often break out',
  'newcomers-some': 'newcomers sometimes break out',
  'newcomers-rarely-break-out': 'newcomers rarely break out',
  'newcomers-unknown': 'too few young channels to conclude',
  'supply-unknown': 'nothing to compare volume against',
  'few-videos': 'fewer than 20 videos in one of the windows — no trend computed',
  'low-coverage': 'we did not catch most videos young — the trend may be a collection artifact',
};

function saturationChip(s) {
  if (!s) return '';
  const [label, cls] = SAT_STATUS[s.status] || [s.status, ''];
  const low = s.confidence === 'low' && s.status !== 'insufficient-data';
  return `<span class="chip ${cls}" data-tip="${scoreTip('nicheTrend', low ? 'low confidence: few videos were caught young' : '')}">${esc(label)}${low ? ' ?' : ''}</span>`;
}

function saturationBlock(s) {
  if (!s) return '';
  const sig = s.signals;
  const x = (r) => (r == null ? '' : ` · ×${r}`);
  const reasons = (s.reasons || []).map((r) => SAT_REASON[r.code] || r.code);
  return `<div class="card">
    ${sectionHead('Niche trend', `last 30 days against the 90 before them · ${s.format === 'short' ? 'Shorts' : 'long videos'}`,
      saturationChip(s))}
    <div class="tiles">
      ${tile('Videos in 30 days', `${num(sig.supply.basePer30d)} → ${num(sig.supply.recent)}`,
        `on average before → now${x(sig.supply.ratio)}`)}
      ${tile('Views of new videos', `${compact(sig.demand.baseMedian)} → ${compact(sig.demand.recentMedian)}`,
        `median forecast at day 30${x(sig.demand.ratio)}`)}
      ${tile('New channels in 30 days', `${num(sig.entrants.basePer30d)} → ${num(sig.entrants.recent)}`,
        sig.entrants.unknownAge ? `without a creation date: ${num(sig.entrants.unknownAge)}` : 'created in the window')}
      ${tile('Newcomers break out', sig.newcomers.share == null ? '—' : `${Math.round(sig.newcomers.share * 100)}%`,
        `${num(sig.newcomers.brokeOut)} of ${num(sig.newcomers.channels)} channels younger than 180 days, multiplier ≥ 2`)}
    </div>
    <ul class="digest-list" style="margin-top:10px">${reasons.map((r) => `<li style="white-space:normal">${esc(r)}</li>`).join('')}</ul>
    <div class="section-sub">Videos: ${num(s.counts.recent)} in 30 days and ${num(s.counts.base)} in the 90 before them.
      ${sig.coverage.caughtYoungShare != null ? `Caught young: ${Math.round(sig.coverage.caughtYoungShare * 100)}%.` : ''}
      Computed only from what is collected here.</div>
  </div>`;
}

/* YPP thresholds (plan 12): what the channel visibly passes in public data. This is not
   a monetization status -- YouTube does not publish it, and that is stated alongside. */
function yppText(e) {
  if (!e) return '';
  const full = e.tiers?.full || {};
  const exp = e.tiers?.expanded || {};
  const shortsSeen = compact(full.shortsViews90d?.seenAtLeast || 0);
  return {
    'below-threshold': 'not reached: under 500 subscribers, the channel cannot enter any YPP tier',
    'subscribers-met': `subscribers reached (${full.subscribers ? '1000+' : '500+'}); watch hours are not available via the API, `
      + `uploads visible in 90 days: ${exp.uploads90d?.seen ?? 0}, Shorts views — at least ${shortsSeen}`,
    'shorts-path-met': `reached via Shorts: at least ${shortsSeen} Shorts views in 90 days`,
    unknown: 'unknown: the subscriber count is hidden',
  }[e.status] || e.status;
}

/* Plan 17: from 01.02.2027 the full YPP tier requires 8,000 hours in 365 days or
   20M Shorts views in 90 days (1,000 subscribers remains). */
const YPP_2027 = 'from 01.02.2027 the full tier will require 8,000 hours in 365 days or 20M Shorts views in 90 days';

function yppLine(e) {
  if (!e) return '';
  const next = e.upcoming
    ? `<br><b>2027 rules:</b> ${YPP_2027}; by visible data — ${
      e.upcoming.status === e.status ? 'the same' : esc(yppText(e.upcoming))}.`
    : e.rules === '2027' ? ' YPP rules from 01.02.2027 apply.' : '';
  return `<div class="section-sub" style="margin-top:8px"><b>YPP threshold</b> ${qmark('ypp')}: ${esc(yppText(e))}.
    This is not a monetization status — YouTube does not publish it; uploads and Shorts are counted from collected videos.${next}</div>`;
}

/* Subscriber milestones (plan 17): a straight line at the pace of our snapshots -- an estimate, not YouTube data. */
const MILESTONE_REASON = {
  'few-snapshots': 'few snapshots', 'short-history': 'history shorter than a week',
  'no-growth': 'no growth', 'too-slow': 'longer than 10 years at this pace',
};

function milestoneText(f) {
  if (f.reached) return `${num(f.target)} — already reached`;
  const d = (iso) => new Date(iso).toLocaleDateString('en-US');
  if (f.eta30 || f.eta90) {
    const parts = [];
    if (f.eta30) parts.push(`≈ ${d(f.eta30)} at the 30-day pace (+${num(f.pace30PerDay)}/day)`);
    if (f.eta90) parts.push(`≈ ${d(f.eta90)} at the 90-day pace`);
    return `${num(f.target)}: ${parts.join(', ')}`;
  }
  return `${num(f.target)}: cannot be estimated — ${MILESTONE_REASON[f.reason] || f.reason}`;
}

function milestonesLine(ms) {
  if (!ms || !ms.forecasts?.length) return '';
  const ypp = ms.ypp1000BeforeRules2027 === true ? ' 1,000 subscribers — before the YPP rule change on 01.02.2027.'
    : ms.ypp1000BeforeRules2027 === false ? ' 1,000 subscribers — after the YPP rule change on 01.02.2027.' : '';
  return `<div class="section-sub" style="margin-top:8px"><b>Milestones</b> ${qmark('milestones')}:
    ${ms.forecasts.map((f) => esc(milestoneText(f))).join('; ')}.${ypp}
    A niche-finder estimate at the pace of our snapshots, not YouTube data.</div>`;
}

/* Search filter by YPP thresholds (plan 12): thresholds the channel has visibly passed. */
const YPP_TIP = 'Not a monetization status: YouTube does not publish it. Only YPP thresholds visible in public data; channels with a hidden subscriber count do not pass';

function yppSelect(id, cur) {
  const opt = (v, l) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${l}</option>`;
  return `<label class="field" data-tip="${YPP_TIP}"><span class="field-label">YPP thresholds</span>
    <select id="${id}">${opt('', 'any')}${opt('subscribers-met', 'subscribers reached')}${
      opt('shorts-path-met', 'passed via Shorts')}</select></label>`;
}

/* Collaboration partners (plan 31): similar channels of your size, active and
   not templated. YouTube provides no contacts -- only channel links. */
const COLLAB_EXCLUDED = { 'off-topic': 'off topic', 'size-unknown': 'size hidden', 'too-small': 'smaller',
  'too-big': 'bigger', inactive: 'inactive', templated: 'templated' };

async function mountCollabs(box, channelId, { bare = false } = {}) {
  if (!box) return;
  // bare: without its own card and heading -- when the screen already draws them (My channels)
  const wrap = (head, body) => (bare ? body : `<div class="card">${head}${body}</div>`);
  box.innerHTML = wrap(sectionHead('Collaboration partners', 'similar channels of your size, active and not templated'),
    '<div class="section-sub">Searching…</div>');
  let d;
  try { d = await api(`/api/channels/${encodeURIComponent(channelId)}/collabs`); }
  catch (e) { box.innerHTML = ''; return; }
  const ex = Object.entries(d.excluded || {}).map(([k, n]) => `${COLLAB_EXCLUDED[k] || k}: ${n}`).join(' · ');
  const rows = (d.candidates || []).map((c) => `<tr>
    <td class="wrap"><a href="#/channel/${esc(c.channelId)}">${esc(c.title || c.channelId)}</a>
      <a class="section-sub" href="https://www.youtube.com/channel/${esc(c.channelId)}" target="_blank" rel="noopener">YouTube ↗</a></td>
    <td class="num">${compact(c.subscribers)} <span class="section-sub" style="display:inline">×${c.sizeRatio}</span></td>
    <td class="num">${Math.round(c.similarity * 100)}%</td>
    <td class="num">${c.daysSinceUpload == null ? '—' : `${Math.round(c.daysSinceUpload)} d ago`}</td>
    <td class="num">${c.growth30dPct == null ? '—' : `${c.growth30dPct > 0 ? '+' : ''}${c.growth30dPct}%`}</td>
    <td class="num"><button class="btn btn-ghost btn-sm js-collab-track" data-id="${esc(c.channelId)}">Track</button></td>
  </tr>`).join('');
  box.innerHTML = wrap(sectionHead('Collaboration partners',
      `similar topic, ×${d.minRatio}–×${d.maxRatio} of your subscribers, an upload within ${d.activeDays} days, not templated`), `
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>Channel</th><th class="num">Subscribers</th>
      <th class="num">Similarity</th><th class="num">Last video</th><th class="num">30-day growth</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`
      : empty(d.hint || 'no suitable channels among the collected ones — collect the niche more widely')}
    <div class="section-sub" style="margin-top:8px">${ex ? `Filtered out of ${num(d.poolSize)} similar: ${esc(ex)}. ` : ''}Collected channels only;
      YouTube provides no contacts — reach out via the links on the channel.</div>`);
  box.querySelectorAll('.js-collab-track').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/api/channels/track', { method: 'POST', body: { channel_id: b.dataset.id, note: 'collaboration' } });
      b.textContent = 'Tracked'; toast('Channel added to the tracker', 'ok'); }
    catch (e) { b.disabled = false; toast(e.message, 'err'); }
  }));
}

/* Net profit (plan 30): the revenue range minus the costs of the selected profile.
   target: { channel_id } or { niche }. Profiles are edited on the "Data" screen. */
const PROFIT_VERDICT = { profitable: ['chip-good', 'profitable'], loss: ['chip-bad', 'loss-making'],
  uncertain: ['chip-warn', 'unclear: depends on RPM'] };

const UPLOADS_BASIS = (b) => (b === 'set by you' ? 'set by you'
  : b.startsWith('long videos') ? 'long videos in 30 days' : 'default');

function money(v) {
  if (v == null) return '—';
  const s = `$${Math.abs(Number(v)).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return v < 0 ? `−${s}` : s;
}
function moneyRange(r) { return `${money(r.low)} … ${money(r.high)}`; }

function profitResult(d) {
  if (!d.found) return empty(d.hint || 'no data');
  const part = d.month || d.video;
  const [cls, label] = PROFIT_VERDICT[part.verdict] || ['', part.verdict];
  const per = d.month ? 'per month' : 'per video';
  const be = d.video?.breakEvenViews;
  return `
    ${d.yppWarning ? notice('The channel does not reach the full YPP tier (1,000 subscribers): ad revenue starts there, below it real revenue may be zero.', 'warn') : ''}
    ${d.hint ? notice('There is no cost profile — costs are assumed to be zero. Add a profile on the "Data" screen.') : ''}
    <div class="tiles">
      ${tile(`Revenue ${per}`, moneyRange(part.revenue), `midpoint ${money(part.revenue.mid)}`)}
      ${tile(`Costs ${per}`, money(part.cost), d.month ? `${num(d.month.uploads)} videos × ${money(d.month.costPerVideo)} + ${money(d.month.overhead)}` : '')}
      ${tile(`Profit ${per}`, moneyRange(part.profit), `midpoint ${money(part.profit.mid)}`)}
      ${tile('Result', `<span class="chip ${cls}">${esc(label)}</span>`)}
      ${be ? tile('Breaks even at', `${num(be.mid)} views`, `from ${num(be.high)} to ${num(be.low)} — by RPM`) : ''}
    </div>
    <div class="section-sub" style="margin-top:8px">RPM: ${money(d.rpm.low)} … ${money(d.rpm.high)} (${d.rpmBasis.includes('real') ? 'your real RPM' : 'category estimate'})${
      d.uploadsBasis ? ` · videos per month: ${num(d.month?.uploads)} (${esc(UPLOADS_BASIS(d.uploadsBasis))})` : ''}${
      d.typicalVideo ? ' · typical niche video: median views and length' : ''}. AdSense only, no sponsors.</div>`;
}

async function mountProfit(box, target) {
  if (!box) return;
  let profiles = [];
  try { profiles = (await api('/api/cost-profiles')).profiles; } catch { /* we compute without profiles too */ }
  const opts = profiles.length
    ? profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
    : '<option value="">no costs</option>';
  box.innerHTML = `<div class="card">${sectionHead('Net profit', 'revenue minus production costs', `
      <select class="js-profit-profile">${opts}</select>
      <input type="number" min="0" class="js-profit-vpm" placeholder="videos/mo" style="width:90px">
      ${qmark('profit')}`)}
    <div class="js-profit-body"><div class="section-sub">Calculating…</div></div>
    <div class="section-sub" style="margin-top:6px">Cost profiles are on the <a href="#/data">Data</a> screen.</div></div>`;
  const load = async () => {
    const body = box.querySelector('.js-profit-body');
    const vpm = box.querySelector('.js-profit-vpm').value;
    try {
      const d = await api('/api/profit' + q({ ...target, profile: box.querySelector('.js-profit-profile').value,
        videos_per_month: vpm === '' ? undefined : vpm }));
      body.innerHTML = profitResult(d);
    } catch (e) { body.innerHTML = empty(e.message); }
  };
  box.querySelector('.js-profit-profile').addEventListener('change', load);
  box.querySelector('.js-profit-vpm').addEventListener('change', load);
  load();
}

/* "What breakouts have in common" (plan 29): traits by which the niche's outliers differ noticeably
   from ordinary videos. Correlation, not cause. only: 'long' | 'short' | null. */
function traitValue(t, v) {
  if (t.kind === 'share') return `${v}%`;
  return t.key === 'duration' ? `${v} s` : `${v}`;
}

function traitLine(t) {
  const n = `${num(t.nOutliers)} and ${num(t.nOrdinary)} videos`;
  if (t.kind === 'share') {
    const pp = Math.abs(t.diff);
    return `<b>${esc(t.label)}</b>: outliers ${t.outliers}% vs ${t.ordinary}% for ordinary ones
      (${t.diff > 0 ? '+' : '−'}${pp} pp) <span class="section-sub" style="display:inline">· ${n}</span>`;
  }
  return `<b>${esc(t.label)}</b>: median ${traitValue(t, t.outliers)} vs ${traitValue(t, t.ordinary)}
    (×${t.diff}) <span class="section-sub" style="display:inline">· ${n}</span>`;
}

function outlierTraitsBlock(d, only = null) {
  if (!d || !d.formats) return '';
  const names = { long: 'long videos', short: 'Shorts' };
  const parts = Object.keys(names).filter((k) => !only || k === only).map((k) => {
    const f = d.formats[k];
    if (!f || (only === null && !f.videos)) return '';
    const head = `${f.outliers} outliers (≥ ×${d.minOutlier}) vs ${f.ordinary} ordinary (≤ ×${d.maxOrdinary})`;
    if (!f.reliable) {
      return `<div><b>${names[k]}</b>: not enough data — ${d.minGroup}+ videos are needed in each group, currently ${head}.</div>`;
    }
    const sig = f.traits.filter((t) => t.significant);
    const rest = f.traits.filter((t) => !t.significant && t.diff !== null);
    return `<div style="margin-bottom:12px"><b>${names[k]}</b> <span class="section-sub" style="display:inline">· ${head}</span>
      ${f.concentrated ? notice(`${Math.round(f.topChannelShare * 100)}% of outliers come from one channel: these are the channel's habits, not the niche's.`, 'warn') : ''}
      ${sig.length ? `<ul class="digest-list">${sig.map((t) => `<li style="white-space:normal">${traitLine(t)}</li>`).join('')}</ul>`
        : '<div class="section-sub">No notable differences: no trait diverged enough.</div>'}
      ${rest.length ? `<details><summary class="section-sub" style="cursor:pointer">No notable difference (${rest.length})</summary>
        <ul class="digest-list">${rest.map((t) => `<li style="white-space:normal">${traitLine(t)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }).join('');
  if (!parts) return '';
  return `<div class="card">${sectionHead('What breakouts have in common',
    'how outliers differ from the niche\'s ordinary videos — by the numbers, no AI', qmark('outlierTraits'))}
    ${parts}<div class="section-sub">Correlation, not cause. Notable means a difference of ${d.minDiffPp} pp (shares) or ${d.minRatio}x (medians);
      many traits are checked, one or two may line up by chance. Times are UTC. An estimate over the collected database.</div></div>`;
}

export { $, api, q, num, compact, mult, ago, esc, delta, plural, pl, toast, tile, sectionHead,
         notice, empty, barList, strengthBar, channelRow, videoCard, table, commentList,
         lineChart, VIEW_COUNT_CHANGE, trajectoryChart, compareHref, loadScores, scoreTip, qmark, policyBlock, nichePolicyBlock, funnelBlock, aiLabelsBadge, scatterChart, state, rpmRange, RPM_TIP, templateRiskBlock,
         nicheTemplateRiskBlock, outlierTraitsBlock, mountProfit, mountCollabs, sponsorBlock, saturationChip, saturationBlock, yppLine, milestonesLine, yppSelect };
