/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, q, num, compact, mult, esc, delta, sectionHead, empty, barList, table, state, rpmRange, RPM_TIP } from '../ui.js';
import { view, plabel, base } from '../shared.js';

/* ------------------------------------------------------------- Categories */

async function viewCategories() {
  const d = await api(`/api/categories${q({ ...base(), rank_by: 'views', limit: 30 })}`);
  const cats = d.categories;
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Popular categories', `${plabel(state.period)} · compared with the previous equal window`)}
      ${cats.length ? barList(cats.map((c) => ({
          name: c.category, value: c.totalViews, display: `${compact(c.totalViews)} (${c.viewShare}%)`,
          tip: `${c.category}<br>videos: <b>${num(c.videos)}</b><br>channels: <b>${num(c.channels)}</b><br>median views: <b>${num(c.medianViews)}</b>`,
        }))) : empty(d.hint || 'no data')}
      <div class="section-sub" style="margin-top:14px">Computed over the local corpus:
        YouTube's own chart since July 2025 covers only Music, Movies and Games and
        cannot rank categories such as Education.</div>
    </div>
    <div class="card">
      ${sectionHead('All metrics by category')}
      ${table([
        { label: 'Category', render: (r) => esc(r.category) },
        { label: 'Videos', num: true, render: (r) => num(r.videos) },
        { label: 'Channels', num: true, render: (r) => num(r.channels) },
        { label: 'Views', num: true, render: (r) => compact(r.totalViews) },
        { label: 'Median', num: true, render: (r) => compact(r.medianViews) },
        { label: 'Share', num: true, render: (r) => `${r.viewShare}%` },
        { label: 'Share shift', num: true, render: (r) => delta(r.shareChange, ' pp') },
        { label: 'Growth', num: true, render: (r) => delta(r.viewsGrowth) },
        { label: 'Median multiplier', num: true, render: (r) => mult(r.medianOutlier) },
        { label: 'Shorts', num: true, render: (r) => `${r.shortsShare}%` },
        { label: 'Niche RPM', num: true, render: (r) => r.estimatedRpmRange
            ? `<span data-tip="${RPM_TIP}">${rpmRange(r.estimatedRpmRange)}</span>` : `$${r.estimatedRpmNiche}` },
      ], cats)}
    </div>`;
}

export { viewCategories };
