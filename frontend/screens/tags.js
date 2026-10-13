/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, q, num, compact, esc, sectionHead, empty, table, state } from '../ui.js';
import { view, plabel, base } from '../shared.js';

/* ---------------------------------------------------- Top tags by category */

async function viewTopTags() {
  const d = await api(`/api/tags/top-by-category${q({ ...base(), min_videos: 3, top_n: 10 })}`);
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Top tags by category', `${plabel(state.period)} · the whole tag as the author wrote it — not split into words`)}
    </div>
    ${d.categories.length ? d.categories.map((c) => `
      <div class="card">
        ${sectionHead(c.category || `Category ${c.categoryId}`, `${num(c.videosAnalysed)} videos analysed`)}
        ${table([
            { label: 'Tag', wrap: true, render: (r) => esc(r.tag) },
            { label: 'Videos', num: true, render: (r) => num(r.videos) },
            { label: 'Share', num: true, render: (r) => `${r.share}%` },
            { label: 'Lift', num: true, render: (r) => r.outlierLift ?? '—' },
            { label: 'Median views', num: true, render: (r) => compact(r.medianViews) },
            { label: 'Example', wrap: true, render: (r) => esc(r.examples?.[0]?.title || '') },
          ], c.tags)}
      </div>`).join('') : `<div class="card">${empty(d.hint || 'no tags above the threshold')}</div>`}
    <div class="card">
      <div class="section-sub">
        <b>Lift</b> — how many times the tag raises a video's chance of breaking out (outlier);
        above 1.5 means the tag really correlates with breakouts and is not just popular.
      </div>
    </div>`;
}

export { viewTopTags };
