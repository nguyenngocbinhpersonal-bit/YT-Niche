/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, esc, sectionHead, empty, videoCard, yppSelect } from '../ui.js';
import { view, base, collectForm, wireCollect, render } from '../shared.js';

/* ------------------------------------------------- Find a niche (free) */

const FIND_SORTS = [
  ['outlier', 'multiplier'], ['outlier_adjusted', 'age-adjusted multiplier'],
  ['views', 'views'], ['vph', 'VPH, 24h'], ['velocity', 'daily growth'],
  ['engagement', 'engagement'], ['acceleration', 'acceleration'], ['published', 'publication date'],
];

/* A readable list of active non-default filters -- needed so that
   "nothing found" explains the reason instead of just shrugging
   (a filter stuck in localStorage such as "subscribers at most 10"
   would otherwise look like the whole search is broken). */
function activeFindFilters(p) {
  const active = [];
  if (p.query) active.push(`topic “${p.query}”`);
  if (p.min_outlier_score) active.push(`multiplier ≥ ${p.min_outlier_score}`);
  if (p.max_subscribers) active.push(`subscribers ≤ ${num(p.max_subscribers)}`);
  if (p.min_rpm) active.push(`RPM ≥ $${p.min_rpm}`);
  if (p.max_rpm) active.push(`RPM ≤ $${p.max_rpm}`);
  if (p.min_length_min) active.push(`video length ≥ ${p.min_length_min} min`);
  if (p.max_length_min) active.push(`video length ≤ ${p.max_length_min} min`);
  if (p.shorts !== 'any') active.push(p.shorts === 'exclude' ? 'no Shorts' : 'Shorts only');
  if (p.min_ypp_status) active.push('YPP thresholds');
  return active;
}

async function viewFind() {
  const p = Object.assign(
    { query: '', min_outlier_score: 0, max_subscribers: '', sort_by: 'outlier',
      min_rpm: '', max_rpm: '', min_length_min: '', max_length_min: '', shorts: 'any',
      min_ypp_status: '' },
    JSON.parse(localStorage.getItem('nf.find') || '{}'));
  const d = await api(`/api/search${q({
    ...base(), query: p.query || null,
    min_outlier_score: p.min_outlier_score || null,
    max_subscribers: p.max_subscribers || null,
    min_rpm: p.min_rpm || null, max_rpm: p.max_rpm || null,
    min_video_length: p.min_length_min ? p.min_length_min * 60 : null,
    max_video_length: p.max_length_min ? p.max_length_min * 60 : null,
    exclude_shorts: p.shorts === 'exclude' || null,
    only_shorts: p.shorts === 'only' || null,
    min_ypp_status: p.min_ypp_status || null,
    sort_by: p.sort_by, limit: 30,
  })}`);

  view.innerHTML = `
    <div class="card">
      ${sectionHead('Find a niche', 'semantic search over the already collected database — free, no YouTube quota spent')}
      <div class="form-row">
        <label class="field" style="flex:2"><span class="field-label">Topic in natural language (optional)</span>
          <input type="text" id="fQuery" placeholder="relaxing nature videos" value="${esc(p.query)}"></label>
        <label class="field"><span class="field-label">Multiplier at least</span>
          <input type="number" id="fMinOutlier" value="${p.min_outlier_score}" step="0.5"></label>
        <label class="field"><span class="field-label">Subscribers at most</span>
          <input type="number" id="fMaxSubs" value="${p.max_subscribers}" step="1000" placeholder="e.g. 100000"></label>
        <label class="field"><span class="field-label">Sort by</span>
          <select id="fFindSort">
            ${FIND_SORTS.map(([v, l]) => `<option value="${v}"${p.sort_by === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
      </div>
      <div class="form-row" style="margin-top:8px">
        <label class="field"><span class="field-label">RPM from, $</span>
          <input type="number" id="fMinRpm" value="${p.min_rpm}" step="1" min="0" placeholder="e.g. 5"></label>
        <label class="field"><span class="field-label">RPM to, $</span>
          <input type="number" id="fMaxRpm" value="${p.max_rpm}" step="1" min="0" placeholder="e.g. 8"></label>
        <label class="field"><span class="field-label">Video length from, min</span>
          <input type="number" id="fMinLen" value="${p.min_length_min}" step="1" min="0" placeholder="e.g. 3"></label>
        <label class="field"><span class="field-label">Video length to, min</span>
          <input type="number" id="fMaxLen" value="${p.max_length_min}" step="1" min="0" placeholder="e.g. 20"></label>
        <label class="field"><span class="field-label">Shorts</span>
          <select id="fShorts">
            <option value="any"${p.shorts === 'any' ? ' selected' : ''}>any</option>
            <option value="exclude"${p.shorts === 'exclude' ? ' selected' : ''}>no Shorts</option>
            <option value="only"${p.shorts === 'only' ? ' selected' : ''}>Shorts only</option>
          </select></label>
        ${yppSelect('fYpp', p.min_ypp_status)}
        <button class="btn" id="applyFind" type="button">Search</button>
        <button class="btn btn-ghost" id="resetFind" type="button">Reset filters</button>
      </div>
      <div class="section-sub" style="margin-top:10px">Searches the already collected videos via title+description embeddings
        (if no topic is set -- just browsing by the selected sort). RPM is an estimate from the video's official
        YouTube category (the same model as the channel revenue estimate), not a measured payout; on cards it is
        shown as a ÷2…×2 range, while the filter compares its midpoint. The YouTube category does not
        distinguish high-paying niches like finance/business, so in practice the estimate does not exceed ~$8 —
        "RPM from $10" and above always gives an empty list. Filters are remembered in this browser between visits —
        if the search suddenly stops finding anything, press "Reset filters". Finds nothing even without
        filters? Below is a quota-limited collection of new data from YouTube, or check the "Data" section to
        check the corpus coverage.</div>
    </div>
    ${d.results.length ? `<div class="cards">${d.results.map(videoCard).join('')}</div>`
                       : empty(activeFindFilters(p).length
                           ? `Nothing found with the filters: ${esc(activeFindFilters(p).join(', '))}. `
                             + 'If you did not set them yourself, press "Reset filters" above.'
                           : 'nothing in the collected database matches these filters')}
    ${collectForm()}`;

  $('#applyFind').addEventListener('click', () => {
    localStorage.setItem('nf.find', JSON.stringify({
      query: $('#fQuery').value.trim(),
      min_outlier_score: +$('#fMinOutlier').value || 0,
      max_subscribers: $('#fMaxSubs').value ? +$('#fMaxSubs').value : '',
      min_rpm: $('#fMinRpm').value ? +$('#fMinRpm').value : '',
      max_rpm: $('#fMaxRpm').value ? +$('#fMaxRpm').value : '',
      min_length_min: $('#fMinLen').value ? +$('#fMinLen').value : '',
      max_length_min: $('#fMaxLen').value ? +$('#fMaxLen').value : '',
      shorts: $('#fShorts').value,
      min_ypp_status: $('#fYpp').value,
      sort_by: $('#fFindSort').value,
    }));
    render();
  });
  $('#resetFind').addEventListener('click', () => {
    localStorage.removeItem('nf.find');
    render();
  });
  wireCollect(render);
}

export { viewFind };
