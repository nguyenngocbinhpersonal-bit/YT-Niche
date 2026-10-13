/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, num, esc, sectionHead, notice, empty, trajectoryChart } from '../ui.js';
import { view } from '../shared.js';

/* ------------------------------------------- Trajectory comparison (plan 20) */

/* Up to 5 videos on one chart: views by age from worker snapshots and
   each channel's expected curve. The basket lives in localStorage (nf.compare),
   the address #/compare/<id,id> is what is visible now, and it can be shared. */
function saveBasket(ids) {
  try { localStorage.setItem('nf.compare', JSON.stringify(ids)); } catch { /* private mode */ }
}

async function viewCompare(arg) {
  const ids = (arg || '').split(',').map((x) => decodeURIComponent(x).trim()).filter(Boolean).slice(0, 5);
  if (!ids.length) {
    view.innerHTML = empty('add a video with the "compare" link on any video card');
    return;
  }
  saveBasket(ids);
  const d = await api(`/api/videos/trajectory?ids=${ids.map(encodeURIComponent).join(',')}`);
  const without = (id) => `#/compare/${ids.filter((x) => x !== id).map(encodeURIComponent).join(',')}`;
  view.innerHTML = `
    ${d.missing.length ? notice(`Not in the database: ${d.missing.map(esc).join(', ')}`, 'warn') : ''}
    <div class="card">
      ${sectionHead('Trajectory comparison', 'views by video age — at the same age, not on the same date')}
      ${trajectoryChart(d.videos)}
      <div class="section-sub" style="margin-top:10px">Points are worker snapshots: every 3 hours during the first week, then once
        a day up to 30 days. The dashed line is how many views an ordinary video of this channel would have by the same age (channel median ×
        maturation curve), a niche-finder estimate. No quota is spent.</div>
    </div>
    <div class="card">
      ${sectionHead('Videos being compared', `${d.videos.length} of 5 — add more with the "compare" link on cards`)}
      <div class="rows">${d.videos.map((v) => `<div class="row">
        <div class="row-main">
          <div class="row-title"><a href="https://www.youtube.com/watch?v=${esc(v.videoId)}" target="_blank" rel="noopener">${esc(v.title || v.videoId)}</a></div>
          <div class="row-sub">${v.channelId ? `<a href="#/channel/${esc(v.channelId)}">${esc(v.channelTitle || v.channelId)}</a> · ` : ''}${num(v.views)} views
            · snapshots ${num(v.points.length)}${v.baselineMedianViews ? ` · channel median ${num(v.baselineMedianViews)}` : ''}</div>
        </div>
        <a class="btn btn-ghost btn-sm" href="${without(v.videoId)}">Remove</a>
      </div>`).join('')}</div>
    </div>`;
}

export { viewCompare };
