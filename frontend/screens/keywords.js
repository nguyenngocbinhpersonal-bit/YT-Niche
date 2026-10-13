/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, esc, tile, sectionHead, empty, table, state } from '../ui.js';
import { view, plabel, base, render } from '../shared.js';

/* --------------------------------------------------------- Keywords */

async function viewKeywords() {
  const semantic = localStorage.getItem('nf.keywordsMode') === 'semantic';
  const d = await api(`/api/keywords${q({ ...base(), sort_by: 'trend', top_n: 60, min_videos: 2,
    keywords_mode: semantic ? 'semantic' : 'ngram' })}`);
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Trending keywords', plabel(state.period), `
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)">
          <input type="checkbox" id="semanticModeToggle" ${semantic ? 'checked' : ''}>
          semantic mode (merging synonyms via embeddings)
        </label>`)}
      <div class="tiles">
        ${tile('Videos analysed', num(d.videosAnalysed))}
        ${tile('In the previous window', num(d.previousWindowVideos))}
        ${tile('Base outlier share', `${d.outlierBaseRate}%`, 'how many videos break out at all')}
        ${tile('Tag coverage', `${d.tagCoveragePercent}%`, 'not all authors set tags')}
      </div>
    </div>
    <div class="card">
      ${d.keywords.length ? table([
        { label: 'Phrase', wrap: true, render: (r) => esc(r.keyword) },
        { label: 'Opportunity', num: true, tip: 'trendScore', render: (r) => r.opportunityScore != null
            ? `<span class="chip ${r.opportunityScore >= 70 ? 'chip-good' : r.opportunityScore < 30 ? 'chip-bad' : ''}">${r.opportunityScore}</span>`
            : '—' },
        { label: 'Videos', num: true, render: (r) => num(r.videos) },
        { label: 'Momentum', num: true, tip: 'trendScore', render: (r) => r.momentum ?? '—' },
        { label: 'Lift', num: true, tip: 'trendScore', render: (r) => r.outlierLift ?? '—' },
        { label: 'Share', num: true, render: (r) => `${r.share}%` },
        { label: 'Median views', num: true, render: (r) => compact(r.medianViews) },
        { label: 'New', render: (r) => (r.isNew ? 'yes' : '') },
        { label: 'Example', wrap: true, render: (r) => esc(r.examples?.[0]?.title || '') },
      ], d.keywords) : empty(d.hint || 'no phrases above the threshold')}
      <div class="section-sub" style="margin-top:14px">
        <b>Opportunity</b> — 0-100, for readability: trendScore stretched across the
        min/max among the phrases on this very screen. This is NOT a real keyword score like
        vidIQ (that would need YouTube search volume, and no such API exists) —
        do not compare this number across different queries or windows, only within
        one current result set.<br>
        <b>momentum</b> — the phrase's share in this window against its share in the previous equal
        window (smoothed); above 2 means fast growth.<br>
        <b>outlierLift</b> — how many times the phrase raises a video's chance of breaking out;
        above 1.5 means the phrase really correlates with breakouts.
      </div>
    </div>`;

  $('#semanticModeToggle').addEventListener('change', (e) => {
    localStorage.setItem('nf.keywordsMode', e.target.checked ? 'semantic' : 'ngram');
    render();
  });
}

export { viewKeywords };
