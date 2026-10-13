/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, compact, mult, esc, toast, sectionHead, empty, notice, table, qmark, state } from '../ui.js';
import { view } from '../shared.js';

/* ----------------------------------------------- Another language (plan 26) */

let pair = { source: '', target: '' };
let filters = { minOutlier: 3, minSimilarity: 0.62 };
let langs = null;
let result = null;

const VERDICT_LABEL = { open: 'not made', thin: 'made weakly', covered: 'already a hit' };
const VERDICT_CLASS = { open: 'chip-good', thin: 'chip-warn', covered: 'chip-bad' };

function verdictChip(v) {
  return `<span class="chip ${VERDICT_CLASS[v] || ''}">${esc(VERDICT_LABEL[v] || v)}</span>`;
}

function videoLink(id, title) {
  return `<a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">${esc(title || id)}</a>`;
}

function targetCell(c) {
  if (c.matches.length) {
    return c.matches.map((m) => `<div>${videoLink(m.videoId, m.title)}
      <span class="section-sub" style="display:inline">· ${esc(m.channelTitle || m.channelId)} · ${mult(m.outlierScore)} · similarity ${m.similarity.toFixed(2)}</span></div>`).join('');
  }
  if (c.nearest) {
    return `<span class="section-sub" style="display:inline">closest — similarity ${c.nearest.similarity.toFixed(2)}, below the threshold</span>`;
  }
  return '<span class="section-sub" style="display:inline">nothing in this language</span>';
}

function resultSection(r) {
  if (!r) return '';
  const c = r.counts;
  const shown = r.gaps.length;
  return `
    ${r.targetCorpus.hint ? notice(esc(r.targetCorpus.hint), 'warn') : ''}
    <div class="card">
      ${sectionHead(`${r.source} → ${r.target}`,
        `${r.sourceOutliers} outliers checked out of ${r.outliersFound} found · in the target language the database has ` +
        `${r.targetCorpus.videos} videos from ${r.targetCorpus.channels} channels`, qmark('languageGap'))}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <span class="chip chip-good">not made: ${c.open}</span>
        <span class="chip chip-warn">made weakly: ${c.thin}</span>
        <span class="chip chip-bad">already a hit: ${c.covered}</span>
        ${shown < r.sourceOutliers ? `<span class="chip">shown ${shown}</span>` : ''}
      </div>
      ${shown ? table([
        { label: 'Video in the source language', wrap: true, render: (g) =>
          `${videoLink(g.videoId, g.title)}<div class="section-sub">${esc(g.channelTitle || g.channelId)} · ${compact(g.views)} views</div>` },
        { label: 'Outlier', num: true, render: (g) => mult(g.outlierScore) },
        { label: 'More channels', num: true, tip: 'How many other channels in the source language got an outlier ≥ ×2 with a similar video',
          render: (g) => g.demand.otherChannelsHit },
        { label: 'Target language', render: (g) => verdictChip(g.verdict) },
        { label: 'What is there', wrap: true, render: targetCell },
      ], r.gaps) : empty('There are no outliers above the threshold in the source language — lower the threshold or collect niches.')}
      <div class="section-sub" style="margin-top:10px">${esc(r.note)}</div>
    </div>`;
}

function options(selected) {
  return langs.map((l) =>
    `<option value="${esc(l.code)}"${l.code === selected ? ' selected' : ''}>${esc(l.code)} · ${l.videos} videos</option>`).join('');
}

async function viewLanguage() {
  if (!langs) langs = (await api('/api/language-gaps/languages')).languages;
  if (langs.length < 2) {
    view.innerHTML = `<div class="card">${sectionHead('Another language',
      'a format broke out in one language — has it been made in another')}
      ${empty('The database has videos in only one language: collect channels in a second language and the screen will work.')}</div>`;
    return;
  }
  if (!pair.source || !langs.some((l) => l.code === pair.source)) pair.source = langs[0].code;
  if (!pair.target || pair.target === pair.source || !langs.some((l) => l.code === pair.target)) {
    pair.target = langs.find((l) => l.code !== pair.source).code;
  }
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Another language', 'a format broke out in one language — has it been made in another' +
        (state.niche ? ` · niche of the source videos: ${state.niche}` : ''))}
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end">
        <label style="font-size:12px;color:var(--muted)">Where it broke out<br>
          <select id="lgSource">${options(pair.source)}</select></label>
        <button class="btn btn-ghost btn-sm" id="lgSwap" title="Swap">⇄</button>
        <label style="font-size:12px;color:var(--muted)">Where to check<br>
          <select id="lgTarget">${options(pair.target)}</select></label>
        <label style="font-size:12px;color:var(--muted)">outlier ≥
          <input type="number" step="0.5" id="lgMinOutlier" value="${filters.minOutlier}" style="width:70px"></label>
        <label style="font-size:12px;color:var(--muted)">similarity ≥
          <input type="number" step="0.01" min="0.3" max="0.95" id="lgMinSim" value="${filters.minSimilarity}" style="width:70px"></label>
        <button class="btn" id="lgRun">Find</button>
      </div>
    </div>
    <div id="lgResult">${resultSection(result)}</div>`;

  $('#lgSwap').addEventListener('click', () => {
    pair = { source: $('#lgTarget').value, target: $('#lgSource').value };
    result = null;
    viewLanguage();
  });
  $('#lgRun').addEventListener('click', async () => {
    pair = { source: $('#lgSource').value, target: $('#lgTarget').value };
    filters = {
      minOutlier: Number($('#lgMinOutlier').value) || 3,
      minSimilarity: Number($('#lgMinSim').value) || 0.62,
    };
    if (pair.source === pair.target) { toast('Pick two different languages', 'err'); return; }
    const btn = $('#lgRun');
    btn.disabled = true; btn.textContent = 'Searching…';
    try {
      result = await api('/api/language-gaps' + q({
        source: pair.source, target: pair.target, niche: state.niche,
        min_outlier: filters.minOutlier, min_similarity: filters.minSimilarity,
      }));
      $('#lgResult').innerHTML = resultSection(result);
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false; btn.textContent = 'Find';
  });
}

export { viewLanguage };
