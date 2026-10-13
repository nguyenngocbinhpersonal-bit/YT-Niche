/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, num, mult, esc, toast, sectionHead, empty, table, saturationChip } from '../ui.js';
import { view } from '../shared.js';

/* ------------------------------------------------------- Niche map (08) */

async function viewNicheClusters() {
  const d = await api('/api/niche-clusters');
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Niche map', 'channel clusters by video embeddings — no manual niche definition',
        `<button class="btn btn-ghost btn-sm" id="clustersRecomputeBtn">Recalculate</button>`)}
      ${d.clusters.length ? table([
        { label: 'Name', wrap: true, render: (c) => `<b>${esc(c.name)}</b>
          ${c.description ? `<div class="row-sub">${esc(c.description)}</div>` : ''}` },
        { label: 'Channels', num: true, render: (c) => num(c.channelCount) },
        { label: 'Median outlier', num: true, render: (c) => mult(c.medianOutlierScore) },
        { label: 'Speed (VPH)', num: true, render: (c) => num(c.totalVelocity) },
        { label: 'Faceless', num: true, render: (c) => c.facelessShare != null ? `${Math.round(c.facelessShare * 100)}%` : '—' },
        { label: 'Competition (>100k)', num: true, render: (c) => num(c.competitionCount) },
        { label: 'Trend', render: (c) => saturationChip(c.saturation) || '—' },
      ], d.clusters) : empty(d.hint || 'no clusters yet')}
    </div>`;

  $('#clustersRecomputeBtn').addEventListener('click', async () => {
    const btn = $('#clustersRecomputeBtn');
    btn.disabled = true;
    btn.textContent = 'Calculating…';
    try {
      await api('/api/niche-clusters/recompute', { method: 'POST' });
      toast('Recalculated', 'ok');
      viewNicheClusters();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
      btn.textContent = 'Recalculate';
    }
  });
}

export { viewNicheClusters };
