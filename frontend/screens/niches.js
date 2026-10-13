/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, num, ago, esc, sectionHead, empty, table, saturationChip } from '../ui.js';
import { view, collectForm, wireCollect, render } from '../shared.js';

/* ------------------------------------------------------------------ Niches */

async function viewNiches() {
  const d = await api('/api/niches');
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Niches', 'everything collected under labels')}
      ${d.niches.length ? table([
        { label: 'Slug', render: (r) => `<a href="#/niche/${esc(r.slug)}">${esc(r.slug)}</a>` },
        { label: 'Query', wrap: true, render: (r) => esc(r.query || '') },
        { label: 'Videos', num: true, render: (r) => num(r.video_count) },
        { label: 'Trend', render: (r) => `<span class="niche-trend" data-slug="${esc(r.slug)}">…</span>` },
        { label: 'Last collected', render: (r) => ago(r.last_collected_at) },
      ], d.niches) : empty('no niches yet')}
    </div>
    ${collectForm()}`;
  wireCollect(render);
  // The trend (plan 08) is computed over all niches for 120 days and on a large database
  // takes seconds -- the list is shown at once, the column is filled in later.
  api('/api/niches/saturation').then((sat) => {
    const trend = Object.fromEntries((sat.niches || []).map((n) => [n.niche, n]));
    view.querySelectorAll('.niche-trend').forEach((el) => {
      el.innerHTML = saturationChip(trend[el.dataset.slug]) || '—';
    });
  }).catch(() => view.querySelectorAll('.niche-trend').forEach((el) => { el.textContent = '—'; }));
}

export { viewNiches };
