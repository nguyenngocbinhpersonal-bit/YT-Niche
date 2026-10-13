/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, esc, sectionHead, notice, empty, videoCard, funnelBlock, state } from '../ui.js';
import { view, plabel, base, render } from '../shared.js';

/* -------------------------------------------------------- Viral videos */

async function viewViral() {
  const p = { period_by: 'discovered', max_subscribers: 100000, min_views: 1000,
              min_views_per_subscriber: 0.5, sort_by: 'viral', limit: 48, preset: '' };
  Object.assign(p, JSON.parse(localStorage.getItem('nf.viral') || '{}'), base());
  if (p.preset === 'niche_all' && !state.niche) p.preset = '';  // the preset requires a niche
  const d = await api(`/api/viral${q(p)}`);

  view.innerHTML = `
    <div class="card">
      ${sectionHead('Viral videos from small channels', plabel(state.period))}
      <div class="form-row">
        <label class="field"><span class="field-label">Window is counted by</span>
          <select id="fPeriodBy">
            <option value="published"${p.period_by === 'published' ? ' selected' : ''}>publication date</option>
            <option value="discovered"${p.period_by === 'discovered' ? ' selected' : ''}>database entry date</option>
          </select></label>
        <label class="field"><span class="field-label">Subscribers at most</span>
          <input type="number" id="fSubs" value="${p.max_subscribers}" step="1000" ${p.preset === 'niche_all' ? 'disabled' : ''}></label>
        <label class="field"><span class="field-label">Views at least</span>
          <input type="number" id="fViews" value="${p.min_views}" step="1000" ${p.preset === 'niche_all' ? 'disabled' : ''}></label>
        <label class="field"><span class="field-label">VSR at least</span>
          <input type="number" id="fVsr" value="${p.min_views_per_subscriber}" step="0.5" ${p.preset === 'niche_all' ? 'disabled' : ''}></label>
        <label class="field"><span class="field-label">Sort by</span>
          <select id="fSort">
            ${[['viral', 'virality'], ['vsr', 'views per subscriber'], ['views', 'views'],
               ['outlier', 'multiplier'], ['vph', 'VPH, 24h'], ['acceleration', 'acceleration'],
               ['published', 'publication date']]
              .map(([v, l]) => `<option value="${v}"${p.sort_by === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select></label>
        <button class="btn" id="applyViral" type="button">Apply</button>
      </div>
      ${state.niche ? `
      <div class="form-row" style="margin-top:8px">
        <label class="field" style="flex:0 0 auto">
          <span class="field-label">&nbsp;</span>
          <span><input type="checkbox" id="fNicheAll" style="width:auto" ${p.preset === 'niche_all' ? 'checked' : ''}>
          all channels of the niche “${esc(state.niche)}”, with no size limit</span></label>
      </div>` : ''}
      <div class="section-sub" style="margin-top:10px">Found: <b>${num(d.matched)}</b> · no quota spent</div>
    </div>
    ${d.error ? notice(esc(d.error), 'error') : ''}
    ${d.results.length ? `<div class="cards">${d.results.map(videoCard).join('')}</div>`
                       : empty('nothing matches these filters')}
    ${funnelBlock(d)}`;

  $('#applyViral').addEventListener('click', () => {
    localStorage.setItem('nf.viral', JSON.stringify({
      period_by: $('#fPeriodBy').value,
      max_subscribers: +$('#fSubs').value,
      min_views: +$('#fViews').value,
      preset: $('#fNicheAll') && $('#fNicheAll').checked ? 'niche_all' : '',
      min_views_per_subscriber: +$('#fVsr').value,
      sort_by: $('#fSort').value,
    }));
    render();
  });
}

export { viewViral };
