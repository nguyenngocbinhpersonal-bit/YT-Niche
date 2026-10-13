/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, mult, ago, esc, toast, tile, sectionHead, notice, empty, table, commentList, lineChart, VIEW_COUNT_CHANGE, aiLabelsBadge, sponsorBlock, state, rpmRange, templateRiskBlock, yppLine, milestonesLine, qmark, policyBlock, mountProfit, mountCollabs } from '../ui.js';
import { view, nicheOverviewBlock } from '../shared.js';

/* ----------------------------------------------------------------- Channel */

async function viewChannel(id) {
  const [a, vel, hist, sim, nicheOv, risk, sponsors] = await Promise.all([
    api(`/api/channels/${encodeURIComponent(id)}${q({ period: state.period })}`),
    api(`/api/channels/${encodeURIComponent(id)}/velocity${q({ period: state.period })}`),
    api(`/api/channels/${encodeURIComponent(id)}/history`),
    api(`/api/channels/${encodeURIComponent(id)}/similar`),
    api(`/api/channels/${encodeURIComponent(id)}/niche-overview`),
    api(`/api/channels/${encodeURIComponent(id)}/template-risk`).catch(() => null),
    // Not critical for the screen: the channel opens even without sponsors.
    api(`/api/channels/${encodeURIComponent(id)}/sponsors${q({ period: state.period })}`)
      .catch(() => null),
  ]);
  view.innerHTML = `
    <div class="card">
      ${sectionHead(a.profile.title || id,
        `${a.profile.handle || ''} · ${a.profile.country || '—'} · created ${
          a.profile.createdAt ? new Date(a.profile.createdAt).toLocaleDateString('en-US') : '—'}`,
        `${aiLabelsBadge(a.profile.aiLabels)}
         <button class="btn btn-ghost btn-sm" id="trackThis">Track</button>
         <a class="btn btn-ghost btn-sm" href="https://www.youtube.com/channel/${esc(id)}" target="_blank" rel="noopener">YouTube</a>`)}
      <div class="tiles">
        ${tile('Subscribers', compact(a.profile.subscribers))}
        ${tile('Views', compact(a.profile.totalViews))}
        ${tile('Videos', num(a.profile.videoCount))}
        ${tile('Uploads per week', a.cadence.uploadsPerWeekLifetime ?? '—')}
        ${tile('Median per video', compact(a.performance.medianViewsPerVideo))}
        ${tile('Viral skew', a.performance.viralSkew ?? '—', 'mean / median')}
        ${tile('Grade', `${esc(a.grade ?? '—')} ${qmark('momentumGrade')}`, a.momentum ? `momentum ${a.momentum}` : 'history needed')}
      </div>
      ${a.gone ? notice(`<div><b>The channel no longer responds to the API</b> since ${
        new Date(a.gone.missingSince).toLocaleDateString('en-US')}: it was deleted, hidden or blocked.
        The numbers on screen are the last we saw. If similar channels in the niche vanish one after another,
        copying their format is risky.</div>`, 'error') : ''}
      ${!a.growthAvailable ? notice(`No growth yet: ${a.snapshots} snapshots.
        It will appear after the worker has run for a few days — <code>docker compose up -d worker</code>.`) : ''}
    </div>

    <div class="card">
      ${sectionHead('Views over time', 'from the snapshots the worker records')}
      ${hist.count > 1
        ? lineChart(hist.points.map((p) => ({ t: p.t, v: p.views })), { valueLabel: 'views', marks: [VIEW_COUNT_CHANGE] })
        : empty(hist.hint)}
    </div>

    <div class="grid-2">
      <div class="card">
        ${sectionHead('Growth')}
        ${table([
          { label: 'Window', render: (r) => r.w },
          { label: 'Subscribers', num: true, render: (r) => (r.subs ? `${r.subs.delta > 0 ? '+' : ''}${num(r.subs.delta)}` : '—') },
          { label: 'per day', num: true, render: (r) => (r.subs ? num(r.subs.per_day) : '—') },
          { label: 'Views', num: true, render: (r) => (r.views ? `${r.views.delta > 0 ? '+' : ''}${compact(r.views.delta)}` : '—') },
          { label: 'per day', num: true, render: (r) => (r.views ? compact(r.views.per_day) : '—') },
        ], ['24h', '7d', '30d', '90d'].map((w) => ({ w, subs: a.growth[w].subscribers, views: a.growth[w].views })))}
        <div class="section-sub" style="margin-top:10px">The API rounds the subscriber count
          to three significant digits, so subscriber deltas are meaningful up to about 100 thousand.
          Views are counted exactly.</div>
      </div>

      <div class="card">
        ${sectionHead('Revenue estimate', 'AdSense only, no integrations')}
        <div class="tiles">
          ${tile('Social Blade range',
            `$${num(a.revenue.socialBladeRange.low_usd)}–${num(a.revenue.socialBladeRange.high_usd)}`, 'per month')}
          ${a.revenue.nicheModel.monthly_usd_low != null
            ? tile('Niche RPM model',
                `$${num(a.revenue.nicheModel.monthly_usd_low)}–${num(a.revenue.nicheModel.monthly_usd_high)}`,
                `per month · RPM ${rpmRange(a.revenue.nicheModel.rpm_range)}`)
            : tile('Niche RPM model', `$${num(a.revenue.nicheModel.monthly_usd)}`,
                `RPM $${a.revenue.nicheModel.rpm_effective}`)}
        </div>
        <div class="section-sub" style="margin-top:10px">AdSense only, without sponsorship
          integrations. Public revenue estimates are regularly off by 2–4x — read this
          as an order of magnitude, not as an amount.</div>
        ${yppLine(a.yppEligibility)}
        ${milestonesLine(a.milestones)}
      </div>
    </div>

    <div class="card">
      ${sectionHead('Top outlier videos', 'against the median of this channel\'s previous uploads')}
      ${table([
        { label: 'Video', wrap: true, render: (r) => `<a href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">${esc(r.title)}</a>` },
        { label: 'Views', num: true, render: (r) => compact(r.views) },
        { label: 'Multiplier', num: true, render: (r) => mult(r.outlierScore) },
        { label: 'Age-adjusted', num: true, render: (r) => mult(r.outlierScoreAgeAdjusted) },
        { label: 'Band', render: (r) => esc(r.band) },
        { label: 'Published', render: (r) => ago(r.publishedAt) },
        { label: '', render: (r) => `<button class="btn btn-ghost btn-sm js-comments" data-video-id="${esc(r.videoId)}" data-video-title="${esc(r.title)}">comments</button>
          <button class="btn btn-ghost btn-sm js-why" data-video-id="${esc(r.videoId)}" data-video-title="${esc(r.title)}">why it broke out</button>` },
      ], a.topOutliers)}
    </div>

    ${templateRiskBlock(risk)}
    <div id="chPolicy"></div>
    <div id="chProfit"></div>
    <div id="chCollabs"></div>

    ${sponsorBlock(sponsors, 'Channel sponsors', 'brands from its video descriptions')}

    <div class="card" id="commentsPanel" hidden></div>
    <div class="card" id="whyPanel" hidden></div>

    <div class="card">
      ${sectionHead('Similar channels', 'by embeddings of the collected videos -- ' +
        (sim.videosEmbedded ? `centroid over ${sim.videosEmbedded} videos of this channel` : 'embeddings needed'))}
      ${sim.similar.length
        ? table([
            { label: 'Channel', wrap: true, render: (r) => `<a href="#/channel/${esc(r.channelId)}">${esc(r.title || r.channelId)}</a>` },
            { label: 'Subscribers', num: true, render: (r) => compact(r.subscriberCount) },
            { label: 'Similarity', num: true, render: (r) => r.similarity.toFixed(2) },
            { label: 'Videos with embedding', num: true, render: (r) => num(r.videosEmbedded) },
          ], sim.similar)
        : empty(sim.hint || 'nothing similar found in the collected corpus')}
    </div>

    ${nicheOv.found
      ? nicheOverviewBlock(nicheOv, sectionHead('Niche overview',
          `across ${nicheOv.peer_channel_count} similar channels -- saturation and entry points without collecting a separate niche`))
      : `<div class="card">
          ${sectionHead('Niche overview')}
          ${empty(nicheOv.hint || 'not enough data for a niche overview')}
        </div>`}

    <div class="card">
      ${sectionHead('Speed by video',
        'VPH over 24 hours and acceleration appear when there are at least two snapshots about a day apart')}
      ${table([
        { label: 'Video', wrap: true, render: (r) => esc(r.title) },
        { label: 'Views', num: true, render: (r) => compact(r.views) },
        { label: 'VPH, all time', num: true, render: (r) => num(r.vphLifetime) },
        { label: 'VPH, 24h', num: true, render: (r) => (r.vph24h != null ? num(r.vph24h) : '—') },
        { label: 'Daily gain', num: true, render: (r) => (r.viewsGained24h != null ? compact(r.viewsGained24h) : '—') },
        { label: 'Trend', render: (r) => (r.trend ? esc(r.trend) : '—') },
      ], vel.videos)}
    </div>`;

  $('#trackThis')?.addEventListener('click', async () => {
    try {
      await api('/api/channels/track', { method: 'POST', body: { channel_id: id } });
      toast('Added to the tracker', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  view.querySelectorAll('.js-comments').forEach((b) => b.addEventListener('click', async () => {
    const panel = $('#commentsPanel');
    panel.hidden = false;
    panel.innerHTML = sectionHead(`Comments: ${esc(b.dataset.videoTitle)}`,
      'live request to YouTube, spends 1 unit of quota') + empty('loading…');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const res = await api(`/api/videos/${encodeURIComponent(b.dataset.videoId)}/comments`,
        { method: 'POST', body: {} });
      panel.innerHTML = sectionHead(`Comments: ${esc(b.dataset.videoTitle)}`,
        'live request to YouTube, spent 1 unit of quota') + commentList(res.comments);
    } catch (e) {
      panel.innerHTML = sectionHead(`Comments: ${esc(b.dataset.videoTitle)}`, '') + empty(e.message);
    }
  }));

  view.querySelectorAll('.js-why').forEach((b) => b.addEventListener('click', async () => {
    const panel = $('#whyPanel');
    panel.hidden = false;
    panel.innerHTML = sectionHead(`Why it broke out: ${esc(b.dataset.videoTitle)}`, '') + empty('loading…');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const res = await api(`/api/video/${encodeURIComponent(b.dataset.videoId)}/why`);
      if (!res) {
        panel.innerHTML = sectionHead(`Why it broke out: ${esc(b.dataset.videoTitle)}`, '')
          + notice('LLM is off -- set LLM_PROVIDER=openrouter and OPENROUTER_API_KEY to enable it');
        return;
      }
      if (res.hint) {
        panel.innerHTML = sectionHead(`Why it broke out: ${esc(b.dataset.videoTitle)}`, '') + notice(esc(res.hint));
        return;
      }
      panel.innerHTML = sectionHead(`Why it broke out: ${esc(b.dataset.videoTitle)}`,
        `confidence: ${Math.round((res.confidence || 0) * 100)}%${res.cached ? ' · from cache' : ''}`) + `
        <div style="border:1px solid var(--border);border-radius:10px;padding:12px">
          ${res.hooks?.length ? `<div style="margin-bottom:8px"><b>Hooks</b>
            <ul style="margin:4px 0 0 18px">${res.hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
          ${res.title_pattern ? `<div class="row-sub" style="margin-bottom:6px"><b>Title pattern:</b> ${esc(res.title_pattern)}</div>` : ''}
          ${res.timing_factor ? `<div class="row-sub" style="margin-bottom:6px"><b>Timing factor:</b> ${esc(res.timing_factor)}</div>` : ''}
          ${res.replicable_formula ? `<div><b>Repeatable formula:</b> ${esc(res.replicable_formula)}</div>` : ''}
        </div>`;
    } catch (e) {
      panel.innerHTML = sectionHead(`Why it broke out: ${esc(b.dataset.videoTitle)}`, '') + empty(e.message);
    }
  }));
  // plan 30: net profit for the selected cost profile
  mountProfit($('#chProfit'), { channel_id: id });
  // plan 31: who to make collaboration videos with
  mountCollabs($('#chCollabs'), id);
  // plan 22: monetization-policy signals -- a separate request, the screen does not wait
  api(`/api/channels/${encodeURIComponent(id)}/policy-signals`)
    .then((r) => { const box = $('#chPolicy'); if (box) box.innerHTML = policyBlock(r); })
    .catch(() => {});
}

export { viewChannel };
