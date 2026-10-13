/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, esc, toast, sectionHead, empty, notice, qmark, saturationChip } from '../ui.js';
import { view } from '../shared.js';

/* ----------------------------------------------- Where to enter (plan 27) */

const TERMS = [
  { key: 'demand', label: 'Demand', fmt: (v) => `×${v}` },
  { key: 'supply', label: 'Supply', fmt: (v) => `×${v}` },
  { key: 'newcomers', label: 'Newcomers', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'rpm', label: 'RPM', fmt: (v) => `$${v}` },
  { key: 'template', label: 'Templated', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'policy', label: 'Signals', fmt: (v) => `${Math.round(v * 100)}%` },
];
const BAND_CLASS = { high: 'chip-good', medium: 'chip-warn', low: 'chip-bad' };
const REASON = {
  'insufficient-data': 'not enough data: the niche trend cannot be computed',
  'few-signals': 'too few known terms',
};

let ranking = null;
let selected = new Set();
let sort = { key: null, dir: 'desc' };
let comparison = null;

const term = (e, key) => e.breakdown.find((b) => b.key === key);

function sortValue(e, key) {
  if (key === 'score') return e.score;
  if (key === 'videos') return e.videos;
  return term(e, key)?.points ?? null;
}

function sorted(list) {
  if (!sort.key) return list;
  const sign = sort.dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
    if (x == null && y == null) return 0;
    if (x == null) return 1;                       // without a value -- always last
    if (y == null) return -1;
    return (x - y) * sign;
  });
}

function scoreCell(e) {
  if (e.score == null) {
    return `<span class="chip" data-tip="${esc(REASON[e.reason] || '')}">no score</span>`;
  }
  return `<span class="chip ${BAND_CLASS[e.band] || ''}"><b>${e.score}</b></span>`;
}

function termCell(e, def) {
  const t = term(e, def.key);
  if (t.value == null) return '<span class="section-sub" style="display:inline">—</span>';
  return `<span data-tip="${esc(`${t.label}: ${def.fmt(t.value)}, weight ${t.weight}`)}">${t.points}
    <span class="section-sub" style="display:inline">(${esc(def.fmt(t.value))})</span></span>`;
}

function rankingTable() {
  const head = (key, label, cls = '') =>
    `<th class="${cls} sortable" data-sort="${key}" style="cursor:pointer">${esc(label)}${
      sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}</th>`;
  const rows = sorted(ranking.niches).map((e) => `<tr>
    <td><input type="checkbox" class="enter-pick" data-slug="${esc(e.niche)}"${
      selected.has(e.niche) ? ' checked' : ''}></td>
    <td class="wrap"><a href="#/niche/${esc(e.niche)}">${esc(e.label || e.niche)}</a>
      <div class="section-sub">${esc(e.niche)} · ${num(e.videos)} videos</div></td>
    <td class="num">${scoreCell(e)}</td>
    <td>${saturationChip({ status: e.status, confidence: e.confidence })}</td>
    ${TERMS.map((d) => `<td class="num">${termCell(e, d)}</td>`).join('')}
  </tr>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th></th>${head('videos', 'Niche / videos')}${head('score', 'Score', 'num')}<th>Trend</th>
      ${TERMS.map((d) => head(d.key, d.label, 'num')).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function compareTable(c) {
  const cols = c.niches;
  const ov = (e, k, f = (v) => num(v)) => (e.overview && e.overview[k] != null ? f(e.overview[k]) : '—');
  const rows = [
    ['Score', (e) => scoreCell(e)],
    ['Trend', (e) => saturationChip({ status: e.status, confidence: e.confidence })],
    ['Videos in the niche', (e) => ov(e, 'video_count')],
    ['Channels', (e) => ov(e, 'channel_count')],
    ['Median subscribers', (e) => ov(e, 'median_subscribers')],
    ['Median outlier', (e) => ov(e, 'median_outlier_score', (v) => `${v}x`)],
    ['Views per video (median)', (e) => ov(e, 'median_views_per_video')],
    ['Shorts share', (e) => ov(e, 'shorts_share_percent', (v) => `${v}%`)],
    ['Small-channel breakouts', (e) => ov(e, 'small_channel_breakouts')],
    ...TERMS.map((d) => [`${d.label} (points · value)`, (e) => termCell(e, d)]),
  ];
  return `<div class="table-wrap"><table>
    <thead><tr><th></th>${cols.map((e) =>
      `<th class="num">${esc(e.label || e.niche)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, f]) => `<tr><td>${esc(label)}</td>${
      cols.map((e) => `<td class="num">${f(e)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function comparisonSection() {
  if (!comparison) return '';
  return `<div class="card">${sectionHead('Niche comparison', 'all indicators side by side')}
    ${comparison.missing.length ? notice(`Not in the database: ${comparison.missing.map(esc).join(', ')}`, 'warn') : ''}
    ${comparison.niches.length ? compareTable(comparison) : empty('nothing to compare')}</div>`;
}

function render() {
  const scored = ranking.niches.filter((n) => n.score != null).length;
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Where to enter', `${scored} niches with a score out of ${ranking.niches.length} · click a header to sort`,
        `<button class="btn btn-ghost btn-sm" id="enterRefresh">Recalculate</button> ${qmark('nicheRank')}`)}
      ${notice('The score is a weighted sum of six terms (in cells: 0–100 points and the value itself). ' +
        'The weights are our judgement, RPM is an estimate, not YouTube data. A niche without a score is too small ' +
        'to judge: it is not "bad", it is just not rated.')}
      ${ranking.niches.length ? rankingTable() : empty('no niches yet — collect the first one')}
      <div style="display:flex;gap:12px;align-items:center;margin-top:12px">
        <button class="btn" id="enterCompare">Compare selected</button>
        <span class="section-sub" id="enterPicked">pick 2–3 niches</span>
      </div>
    </div>
    <div id="enterComparison">${comparisonSection()}</div>`;
  const picked = () => {
    $('#enterPicked').textContent = selected.size ? `selected: ${selected.size}` : 'pick 2–3 niches';
  };
  picked();
  view.querySelectorAll('th.sortable').forEach((th) => th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sort = sort.key === key ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' };
    render();
  }));
  view.querySelectorAll('.enter-pick').forEach((box) => box.addEventListener('change', () => {
    if (box.checked && selected.size >= 3) { box.checked = false; toast('No more than three niches', 'err'); return; }
    if (box.checked) selected.add(box.dataset.slug); else selected.delete(box.dataset.slug);
    picked();
  }));
  $('#enterCompare').addEventListener('click', async () => {
    if (selected.size < 2) { toast('Pick 2–3 niches', 'err'); return; }
    const btn = $('#enterCompare');
    btn.disabled = true; btn.textContent = 'Comparing…';
    try {
      comparison = await api('/api/niches/compare' + q({ slugs: [...selected].join(',') }));
      $('#enterComparison').innerHTML = comparisonSection();
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false; btn.textContent = 'Compare selected';
  });
  $('#enterRefresh').addEventListener('click', async () => {
    $('#enterRefresh').disabled = true;
    ranking = await api('/api/niches/ranking' + q({ refresh: 'true' }));
    render();
  });
}

async function viewEnter() {
  ranking = await api('/api/niches/ranking');
  selected = new Set([...selected].filter((s) => ranking.niches.some((n) => n.niche === s)));
  render();
}

export { viewEnter };
