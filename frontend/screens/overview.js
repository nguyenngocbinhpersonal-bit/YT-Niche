/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, q, num, compact, esc, delta, tile, sectionHead, notice, empty, barList, channelRow, videoCard, pl, state } from '../ui.js';
import { view, plabel, base } from '../shared.js';

/* --------------------------------------------------------------- Overview */

/* "Last 24 hours" -- the same as what goes to Telegram in the morning digest (plan 07). */
const DIGEST_SECTIONS = [
  ['outliers', 'New outlier videos', (e) => `×${e.payload.outlierScore} · ${e.payload.title || e.payload.videoId}`],
  ['acceleration', 'Accelerating', (e) => `×${e.payload.acceleration} · ${e.payload.title || e.payload.videoId}`],
  ['risingChannels', 'Rising channels', (c) => `${c.channelTitle || c.channelId} · ×${c.multiplier}`],
  ['repackaging', 'Repackaging', (s) => s.field === 'title' ? `title: ${s.new}` : `thumbnail: ${s.title || s.videoId}`],
  ['gone', 'Gone', (e) => `${e.kind === 'channel_gone' ? 'channel' : 'video'} ${e.payload.title || ''}`],
];

function digestBlock(g) {
  if (!g) return '';
  const secs = DIGEST_SECTIONS.filter(([key]) => g[key] && g[key].total);
  return `<section class="card">
    ${sectionHead('Last 24 hours', 'the same as the morning Telegram digest with NOTIFY_MODE=digest')}
    ${g.empty ? empty('nothing notable in the last 24 hours') : `<div class="grid-2">${secs.map(([key, title, line]) => `
      <div>
        <div class="section-sub"><b>${esc(title)}</b> · ${num(g[key].total)}</div>
        <ul class="digest-list">${g[key].items.map((x) => `<li>${esc(line(x))}</li>`).join('')}</ul>
      </div>`).join('')}</div>`}
  </section>`;
}

async function viewOverview() {
  const [d, g] = await Promise.all([
    api(`/api/overview${q(base())}`),
    api('/api/digest').catch(() => null),
  ]);
  const cov = d.coverage;
  const thin = cov.videosPublishedInPeriod < 5;

  view.innerHTML = `
    ${thin ? notice(`For the ${plabel(state.period)} window the database holds only
      <b>${cov.videosPublishedInPeriod}</b> videos out of ${num(cov.videosTotal)}.
      The sections below use the "when we first saw it" window, so they show something,
      but an honest picture needs more channels collected — it's cheap, ≈1 unit per 50 videos.`) : ''}

    <div class="tiles">
      ${tile('Channels', num(d.stats.channels))}
      ${tile('Videos', num(d.stats.videos))}
      ${tile('Stat snapshots', num(d.stats.video_stat_snapshots),
        d.stats.history_since ? `history since ${new Date(d.stats.history_since).toLocaleDateString('en-US')}`
                              : 'no history yet')}
      ${tile('Tracked', num(d.stats.tracked_channels))}
      ${tile('Videos in window', num(cov.videosPublishedInPeriod), plabel(state.period))}
      ${tile('Without embedding', num(d.stats.videos_without_embedding), 'the worker will compute it')}
    </div>

    ${digestBlock(g)}

    <div class="grid-2">
      <section class="card">
        ${sectionHead('Recently added outlier channels', plabel(state.period),
          '<a class="btn btn-ghost btn-sm" href="#/channels">All</a>')}
        ${d.outlierChannels.channels.length
          ? `<div class="rows">${d.outlierChannels.channels.map(channelRow).join('')}</div>`
          : empty(d.outlierChannels.hint || 'no channels passed the multiplier threshold')}
      </section>

      <section class="card">
        ${sectionHead('Future competition', `${plabel(d.widePeriod)} · young fast-growing channels`)}
        ${d.competition.channels.length
          ? `<div class="rows">${d.competition.channels.slice(0, 6).map((c) => `
              <div class="row">
                <div class="avatar">${esc((c.channelTitle || '?').slice(0, 1).toUpperCase())}</div>
                <div class="row-main">
                  <div class="row-title"><a href="#/channel/${esc(c.channelId)}">${esc(c.channelTitle)}</a></div>
                  <div class="row-sub">${compact(c.subscribers)} subs · ${
                    pl(c.uploadsInWindow, 'upload', 'uploads')} · ${
                    c.channelAgeDays ? `${num(c.channelAgeDays)} d` : 'age unknown'}</div>
                </div>
                <div class="row-metrics">
                  <div class="metric" data-tip="medianMultiplier × log2(1+uploads) × youth factor">
                    <div class="metric-value">${c.competitionScore}</div>
                    <div class="metric-label">score</div>
                  </div>
                </div>
              </div>`).join('')}</div>`
          : empty('no channels — more data is needed for this window')}
      </section>
    </div>

    <section class="card">
      ${sectionHead('Popular categories', `${plabel(state.period)} · by channel count`,
        '<a class="btn btn-ghost btn-sm" href="#/categories">More</a>')}
      ${d.categories.categories.length
        ? `<div class="scroller">${d.categories.categories.map((c) => `
            <div class="cat-card" data-tip="${esc(c.category)}: ${num(c.videos)} videos, ${compact(c.totalViews)} views">
              <div class="cat-name">${esc(c.category)}</div>
              <div class="cat-count">${pl(c.channels, 'channel', 'channels')} · ${num(c.videos)} videos</div>
              <div class="cat-delta">${c.shareChange != null ? delta(c.shareChange, ' pp share')
                                                             : '<span class="chip">no comparison</span>'}</div>
            </div>`).join('')}</div>`
        : empty(d.categories.hint || 'no data')}
    </section>

    <section class="card">
      ${sectionHead('Trending keywords', `${plabel(state.period)} · by trendScore`,
        '<a class="btn btn-ghost btn-sm" href="#/keywords">All</a>')}
      ${d.keywords.keywords.length
        ? barList(d.keywords.keywords.slice(0, 10).map((k) => ({
            name: k.keyword, value: k.trendScore, display: k.trendScore,
            tip: `${k.keyword}<br>videos: <b>${k.videos}</b><br>momentum: <b>${k.momentum ?? '—'}</b><br>lift: <b>${k.outlierLift ?? '—'}</b>`,
          })))
        : empty(d.keywords.hint || 'no phrases pass the threshold')}
    </section>

    <section class="card">
      ${sectionHead('Viral videos from small channels', `${plabel(state.period)} · by database entry date`,
        '<a class="btn btn-ghost btn-sm" href="#/viral">All</a>')}
      ${d.viral.results.length
        ? `<div class="cards">${d.viral.results.map(videoCard).join('')}</div>`
        : empty(d.viral.hint || 'no videos match the filters')}
    </section>`;
}

export { viewOverview };
