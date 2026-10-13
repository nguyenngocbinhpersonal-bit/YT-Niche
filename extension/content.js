/* Panels and badges on top of YouTube.
 *
 * Three screens: the video page (a panel in the right column), the channel page
 * (a panel under the header) and any video lists (a multiplier badge on the thumbnail).
 * Nobody goes to the network from here — everything goes through the service worker, see background.js.
 *
 * YouTube is a SPA: the DOM survives page transitions, mount points
 * appear with a delay and are recreated. That is why waitFor() is used everywhere here
 * and a re-render on the yt-navigate-finish event, not a one-off querySelector.
 */
(() => {
  if (window.top !== window) return;          // do not run in embedded players
  if (window.__nicheFinderLoaded) return;
  window.__nicheFinderLoaded = true;

  let SETTINGS = null;
  let currentKey = '';

  // --------------------------------------------------------------- utilities

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else resolve(res || { ok: false, error: 'empty response' });
      });
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });

  const NF = new Intl.NumberFormat('en-US');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function compact(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const a = Math.abs(n);
    const cut = (v, s) => (v).toFixed(v >= 100 ? 0 : 1).replace('.0', '') + s;
    if (a >= 1e9) return cut(n / 1e9, 'B');
    if (a >= 1e6) return cut(n / 1e6, 'M');
    if (a >= 1e3) return cut(n / 1e3, 'K');
    return NF.format(Math.round(n));
  }

  function decimal(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    // trailing zeros are trimmed only after the decimal point: 1000 -> "1000", 2.50 -> "2.5"
    return Number(n).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  function pct(n) { return n == null ? '—' : decimal(n, 2) + '%'; }

  function plural(n, one, many) {
    return Math.abs(Math.round(n || 0)) === 1 ? one : many;
  }

  function duration(sec) {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  function ageText(days) {
    if (days == null) return '—';
    if (days < 1) return Math.max(1, Math.round(days * 24)) + ' h';
    if (days < 45) return Math.round(days) + ' d';
    if (days < 400) return Math.round(days / 30) + ' mo';
    return decimal(days / 365, 1) + ' y';
  }

  const BANDS = {
    'normal': ['normal', 1],
    'above average': ['above average', 2],
    'noteworthy': ['noteworthy', 3],
    'strong outlier': ['strong outlier', 4],
    'viral': ['viral', 5],
    'mega outlier': ['mega outlier', 6],
  };
  const bandName = (b) => (BANDS[b] || ['—', 1])[0];
  const bandLevel = (b) => (BANDS[b] || ['—', 1])[1];

  function waitFor(selector, timeout = 12000) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); clearTimeout(timer); resolve(el); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => { obs.disconnect(); resolve(null); }, timeout);
    });
  }

  // -------------------------------------------------------- panel frame

  function ensurePanel(mount, id, where = 'prepend') {
    let root = document.getElementById(id);
    const placed = where === 'prepend' ? root && root.parentElement === mount
                                       : root && mount.nextElementSibling === root;
    if (root && root.isConnected && placed) return root;
    if (root) root.remove();
    root = document.createElement('div');
    root.id = id;
    root.className = 'nf-panel';
    if (where === 'prepend') mount.prepend(root); else mount.after(root);
    return root;
  }

  function removePanels() {
    document.querySelectorAll('.nf-panel').forEach((el) => el.remove());
  }

  const header = (subtitle, statusHtml = '') => `
    <div class="nf-head">
      <div class="nf-logo">niche&#8209;finder</div>
      <div class="nf-sub">${esc(subtitle)}</div>
      ${statusHtml}
      <button class="nf-icon-btn nf-refresh" title="Refresh (spends 1-2 units of quota)">⟳</button>
    </div>`;

  const skeleton = (text) => header(text) + `
    <div class="nf-body"><div class="nf-skeleton"></div><div class="nf-skeleton"></div>
    <div class="nf-skeleton nf-short"></div></div>`;

  function errorHtml(res) {
    const offline = res.offline;
    return header('no connection to the backend') + `
      <div class="nf-body">
        <div class="nf-error">${esc(res.error || 'error')}</div>
        ${offline ? `<div class="nf-hint">Start the project backend:<br>
          <code>make dev</code> or <code>docker compose up -d web</code>,<br>
          then press "Retry".</div>` : ''}
        <button class="nf-btn nf-retry">Retry</button>
      </div>`;
  }

  function statusChip(d) {
    const fromApi = d.fetchedFromApi;
    const label = fromApi ? `fetched on demand · ${d.quotaUnits || 0} units` : 'from the local database';
    return `<span class="nf-chip ${fromApi ? 'nf-chip-api' : ''}" title="${
      fromApi ? 'The data was not in the database or was stale — fetched from the YouTube Data API and saved'
              : 'The response is entirely from the local Postgres, no quota spent'}">${esc(label)}</span>`;
  }

  const cell = (label, value, hint = '') => `
    <div class="nf-cell" ${hint ? `title="${esc(hint)}"` : ''}>
      <div class="nf-cell-v">${value}</div>
      <div class="nf-cell-l">${esc(label)}</div>
    </div>`;

  // ------------------------------------------------------- video page

  function videoHtml(d, similar, llmOn) {
    const v = d.video, c = d.channel, m = d.metrics;
    const similarList = (similar?.similar || []).slice(0, 5);
    const score = m.outlierScore;
    const lvl = bandLevel(m.outlierBand);
    const baseText = m.baselineMedianViews
      ? `median of the channel's last ${m.baselineSample} videos: ${compact(m.baselineMedianViews)}`
      : (c.avgViews ? `channel average over all time: ${compact(c.avgViews)}` : 'no comparison baseline');

    const vph = m.vph24h != null ? m.vph24h : m.vphLifetime;
    const vphLabel = m.vph24h != null ? 'views/hour (24h)' : 'views/hour (all time)';
    const accel = m.acceleration;

    const tags = (v.tags || []).slice(0, 18);
    const tagsHtml = tags.length
      ? `<div class="nf-tags">${tags.map((t) => `<span class="nf-tag">${esc(t)}</span>`).join('')}</div>
         <button class="nf-link nf-copy-tags">Copy all tags (${(v.tags || []).length})</button>`
      : `<div class="nf-hint">No tags — the author did not set them or they are hidden.</div>`;

    return header(v.isShort ? 'Shorts' : 'Video', statusChip(d)) + `
      <div class="nf-body">
        <div class="nf-hero nf-band-${lvl}">
          <div class="nf-score">${score != null ? '×' + decimal(score, score < 10 ? 2 : 1) : '—'}</div>
          <div class="nf-hero-txt">
            <div class="nf-band">${esc(bandName(m.outlierBand))}</div>
            <div class="nf-hint">${esc(baseText)}</div>
          </div>
        </div>

        <div class="nf-grid">
          ${cell('views', compact(v.views))}
          ${cell(vphLabel, compact(vph), 'Computed from our own snapshots if there is history')}
          ${cell('per subscriber', m.viewsPerSubscriber != null ? '×' + decimal(m.viewsPerSubscriber, 2) : '—',
            'VSR: >1 means the video went far beyond its own audience')}
          ${cell('engagement', pct(m.engagementRate), '(likes + comments) / views')}
          ${cell('forecast at day 30', compact(m.projected30dViews),
            'Views scaled to a common 30-day horizon by the maturation curve')}
          ${cell('age', ageText(v.ageDays) + (v.durationSeconds ? ' · ' + duration(v.durationSeconds) : ''))}
        </div>

        ${accel ? `<div class="nf-note ${accel >= 1.5 ? 'nf-hot' : (accel <= 0.7 ? 'nf-cold' : '')}">
          Acceleration ×${decimal(accel, 2)} — ${accel >= 1.5 ? 'the video is speeding up' : accel <= 0.7 ? 'the video is cooling' : 'steady pace'}
          <span class="nf-hint">(24h vs a week)</span></div>` : ''}

        <div class="nf-row">
          <span class="nf-muted">Revenue, estimate:</span>
          <b>$${decimal(d.revenue.lifetime.low_usd, 0)}–$${decimal(d.revenue.lifetime.high_usd, 0)}</b>
          <span class="nf-hint">all time, Social Blade range · ${AD_ONLY}</span>
        </div>

        <div class="nf-channel">
          <div class="nf-ch-title">${esc(c.title || 'channel')}</div>
          <div class="nf-hint">
            ${c.subscribersHidden ? 'subscribers hidden'
              : compact(c.subscribers) + ' ' + plural(c.subscribers, 'subscriber', 'subscribers')} ·
            ${compact(c.avgViews)} on average per video ·
            ${c.videosStored ? c.videosStored + ' ' + plural(c.videosStored, 'video', 'videos') + ' in the database'
                             : 'no videos in the database'}
          </div>
        </div>

        ${tagsHtml}

        <div class="nf-actions">
          <button class="nf-btn nf-collect">${c.videosStored ? 'Refresh the channel in the database' : 'Collect the channel (100 videos)'}</button>
          <button class="nf-btn nf-track">${c.tracked ? 'Untrack' : 'Track'}</button>
          <button class="nf-btn nf-ghost nf-save">Save</button>
          <button class="nf-btn nf-ghost nf-topic"
             title="An alert when a video on this topic enters the database (based on the video title; edit it on the \"Alerts\" screen)">Follow topic</button>
          <a class="nf-btn nf-ghost nf-brief" target="_blank" rel="noopener"
             title="Build a brief for your own video from this video">Brief</a>
          <a class="nf-btn nf-ghost nf-dash" target="_blank" rel="noopener">Dashboard</a>
        </div>
        ${similarList.length ? `<div class="nf-sec">
          <div class="nf-sec-h">Similar videos</div>
          ${similarList.map((s) => `<a class="nf-item" href="/watch?v=${esc(s.videoId)}">
            <span class="nf-item-t">${esc(s.title || s.videoId)}</span>
            <span class="nf-hint">${compact(s.views)} · ${decimal(s.similarity * 100, 0)}%${s.sameChannel ? ' · same channel' : ''}</span></a>`).join('')}
          <div class="nf-hint">We search only the collected database, not all of YouTube — empty does not mean "nothing similar".</div>
        </div>` : ''}

        <div class="nf-sec nf-comments-sec">
          <button class="nf-btn nf-ghost nf-comments-btn">Show comments (1 unit of quota)</button>
          <div class="nf-comments-body"></div>
        </div>

        <div class="nf-pk"></div>

        <div class="nf-sec nf-rep-sec">
          <button class="nf-btn nf-ghost nf-rep-btn" title="Videos of other channels similar in meaning: who else it worked for. No quota is spent">Is the format repeated?</button>
          <div class="nf-rep-body"></div>
        </div>

        <div class="nf-sec nf-lg-sec">
          <button class="nf-btn nf-ghost nf-lg-btn" title="Is there a similar video in another language in your database: the format may be open. No quota is spent">In another language?</button>
          <div class="nf-lg-body"></div>
        </div>

        ${llmOn ? `<div class="nf-sec nf-why-sec">
          <button class="nf-btn nf-ghost nf-why-btn">Why did it break out?</button>
          <div class="nf-why-body"></div>
        </div>` : ''}

        <div class="nf-foot">${d.history.points > 1
          ? `history: ${d.history.points} ${plural(d.history.points, 'snapshot', 'snapshots')}`
          : 'history is empty — start the worker so speed and acceleration appear'}</div>
      </div>`;
  }

  function notFoundHtml(d, what) {
    return header('no data', '') + `
      <div class="nf-body">
        <div class="nf-hint">${esc(d.hint || 'could not find ' + what)}</div>
        <button class="nf-btn nf-retry">Retry</button>
      </div>`;
  }

  function wireCommon(root, onRetry) {
    const retry = root.querySelector('.nf-retry');
    if (retry) retry.addEventListener('click', onRetry);
    const refresh = root.querySelector('.nf-refresh');
    if (refresh) refresh.addEventListener('click', onRetry);
  }

  async function renderWatch(videoId, opts = {}) {
    const mount = await waitFor('#secondary-inner, #secondary');
    if (!mount || getVideoId() !== videoId) return;
    const root = ensurePanel(mount, 'nf-panel-video');
    root.innerHTML = skeleton('analysing the video…');

    const res = await send({ type: 'video', videoId, refresh: !!opts.refresh });
    if (!root.isConnected || getVideoId() !== videoId) return;

    if (!res.ok) {
      root.innerHTML = errorHtml(res);
      wireCommon(root, () => renderWatch(videoId, { refresh: true }));
      return;
    }
    const d = res.data;
    if (!d.found) {
      root.innerHTML = notFoundHtml(d, 'video');
      wireCommon(root, () => renderWatch(videoId, { refresh: true }));
      return;
    }

    const sr = await send({ type: 'similarVideos', videoId });
    if (!root.isConnected || getVideoId() !== videoId) return;
    const statsRes = await send({ type: 'stats' });
    const llmOn = statsRes.ok && statsRes.data?.llm?.provider && statsRes.data.llm.provider !== 'none';
    if (!root.isConnected || getVideoId() !== videoId) return;

    root.innerHTML = videoHtml(d, sr.ok ? sr.data : null, llmOn);
    wireCommon(root, () => renderWatch(videoId, { refresh: true }));

    const dash = root.querySelector('.nf-dash');
    if (dash) dash.href = (SETTINGS?.baseUrl || 'http://127.0.0.1:8080');
    const brief = root.querySelector('.nf-brief');
    if (brief) brief.href = (SETTINGS?.baseUrl || 'http://127.0.0.1:8080') + '/#/brief/' + encodeURIComponent(videoId);

    const copy = root.querySelector('.nf-copy-tags');
    if (copy) copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText((d.video.tags || []).join(', '));
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = `Copy all tags (${(d.video.tags || []).length})`; }, 1500);
    });

    const collect = root.querySelector('.nf-collect');
    if (collect) collect.addEventListener('click', async () => {
      collect.disabled = true; collect.textContent = 'Collecting…';
      const r = await send({ type: 'collect', channel: d.channel.channelId, maxVideos: 100 });
      collect.textContent = r.ok ? `Done: ${r.data.videos_stored} videos` : 'Error';
      setTimeout(() => renderWatch(videoId, { refresh: true }), 1200);
    });

    const track = root.querySelector('.nf-track');
    if (track) track.addEventListener('click', async () => {
      track.disabled = true;
      const r = await send({ type: d.channel.tracked ? 'untrack' : 'track', channelId: d.channel.channelId });
      track.disabled = false;
      if (r.ok) { d.channel.tracked = !d.channel.tracked; track.textContent = d.channel.tracked ? 'Untrack' : 'Track'; }
    });

    const save = root.querySelector('.nf-save');
    if (save) save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await send({ type: 'save', kind: 'video', refId: d.videoId, payload: d });
      save.textContent = r.ok ? 'Saved' : 'Error';
      setTimeout(() => { save.disabled = false; save.textContent = 'Save'; }, 1500);
    });

    const topic = root.querySelector('.nf-topic');
    if (topic) topic.addEventListener('click', async () => {
      topic.disabled = true;
      const r = await send({ type: 'watchTopic', text: (d.video?.title || '').slice(0, 300) });
      topic.textContent = r.ok ? 'Topic added' : 'Error';
      setTimeout(() => { topic.disabled = false; topic.textContent = 'Follow topic'; }, 1500);
    });

    const commentsBtn = root.querySelector('.nf-comments-btn');
    if (commentsBtn) commentsBtn.addEventListener('click', async () => {
      commentsBtn.disabled = true;
      commentsBtn.textContent = 'Loading…';
      const body = root.querySelector('.nf-comments-body');
      const r = await send({ type: 'comments', videoId, maxResults: 50 });
      if (!root.isConnected) return;
      if (!r.ok) {
        commentsBtn.disabled = false;
        commentsBtn.textContent = 'Failed, retry';
        if (body) body.innerHTML = `<div class="nf-error">${esc(r.error || 'error')}</div>`;
        return;
      }
      commentsBtn.remove();
      if (body) body.innerHTML = commentsHtml(r.data, d.video.publishedAt);
    });

    // plan 21: was the format repeated by other channels, or is it one-off luck
    const repBtn = root.querySelector('.nf-rep-btn');
    if (repBtn) repBtn.addEventListener('click', async () => {
      repBtn.disabled = true;
      repBtn.textContent = 'Calculating…';
      const r = await send({ type: 'repeatability', videoId });
      if (!root.isConnected) return;
      const body = root.querySelector('.nf-rep-body');
      if (!r.ok) {
        repBtn.disabled = false;
        repBtn.textContent = 'Failed, retry';
        if (body) body.innerHTML = `<div class="nf-hint">${esc(r.error || '')}</div>`;
        return;
      }
      const d = r.data;
      const label = { repeatable: 'repeated', mixed: 'worked for some',
        one_off: 'looks like one-off luck', unknown: 'not enough data' }[d.verdict] || d.verdict;
      repBtn.remove();
      if (body) body.innerHTML = `<div class="nf-row"><span class="nf-muted">Format:</span> <b>${esc(label)}</b>
        <span class="nf-hint">${d.verdict === 'unknown' ? (d.reason === 'no-embedding' ? 'no embedding' : 'few similar videos')
          : `outlier at ${d.channelsHit} of ${d.channels} channels`} · estimate from the collected database</span></div>`;
    });

    // plan 26: has a similar video been made in another language (the target language is the largest other one in the database)
    const lgBtn = root.querySelector('.nf-lg-btn');
    if (lgBtn) lgBtn.addEventListener('click', async () => {
      lgBtn.disabled = true;
      lgBtn.textContent = 'Searching…';
      const r = await send({ type: 'languageGap', videoId });
      if (!root.isConnected) return;
      const body = root.querySelector('.nf-lg-body');
      if (!r.ok) {
        lgBtn.disabled = false;
        lgBtn.textContent = 'Failed, retry';
        if (body) body.innerHTML = `<div class="nf-hint">${esc(r.error || '')}</div>`;
        return;
      }
      const d = r.data;
      lgBtn.remove();
      if (!body) return;
      if (!d.verdict) { body.innerHTML = `<div class="nf-hint">${esc(d.hint || 'nothing to compare')}</div>`; return; }
      const label = { open: 'nothing similar', thin: 'made, but weakly', covered: 'already a hit' }[d.verdict] || d.verdict;
      const top = d.matches && d.matches[0];
      body.innerHTML = `<div class="nf-row"><span class="nf-muted">In ${esc(d.targetLabel)}:</span> <b>${esc(label)}</b>
        <span class="nf-hint">${top ? esc(top.title || '') + ' · ' : ''}${d.targetCorpus.thin ? 'few videos in this language in the database · ' : ''}estimate from the collected database</span></div>`;
    });

    const whyBtn = root.querySelector('.nf-why-btn');
    if (whyBtn) whyBtn.addEventListener('click', async () => {
      whyBtn.disabled = true;
      whyBtn.textContent = 'Asking…';
      const body = root.querySelector('.nf-why-body');
      const r = await send({ type: 'why', videoId });
      if (!root.isConnected) return;
      if (!r.ok || !r.data || !r.data.hooks) {
        whyBtn.disabled = false;
        whyBtn.textContent = 'Failed, retry';
        if (body) body.innerHTML = `<div class="nf-hint">${esc(
          (r.ok ? r.data?.hint : r.error) || 'LLM unavailable')}</div>`;
        return;
      }
      whyBtn.remove();
      if (body) body.innerHTML = whyViralHtml(r.data);
    });

    // plan 20: a mini chart of views from snapshots instead of the single "history: N" line
    const tj = await send({ type: 'trajectory', videoId });
    if (!root.isConnected || getVideoId() !== videoId) return;
    const foot = root.querySelector('.nf-foot');
    const tv = tj.ok && tj.data?.videos?.[0];
    if (foot && tv && tv.points.length >= 2) foot.innerHTML = sparkline(tv);

    const pk = await send({ type: 'packaging', videoId });
    if (!root.isConnected || getVideoId() !== videoId) return;
    const pkBox = root.querySelector('.nf-pk');
    if (pkBox && pk.ok && pk.data && pk.data.count > 0) pkBox.innerHTML = packagingHtml(pk.data);
  }

  function packagingHtml(p) {
    const titles = p.changes.filter((c) => c.field === 'title').length;
    const thumbs = p.changes.filter((c) => c.field === 'thumbnail_image').length;
    const parts = [];
    if (titles) parts.push(`title ×${titles}`);
    if (thumbs) parts.push(`thumbnail ×${thumbs}`);
    const dash = (SETTINGS?.baseUrl || 'http://127.0.0.1:8080') + '/#/packaging';
    return `<div class="nf-sec">
      <div class="nf-sec-h">Repackaged ${p.count} ${plural(p.count, 'time', 'times')}</div>
      <div class="nf-hint">${esc(parts.join(' · '))} · last change ${esc(ageText(
        (Date.now() - new Date(p.changes[0].changedAt).getTime()) / 864e5))} ago</div>
      <a class="nf-btn nf-ghost" href="${esc(dash)}" target="_blank" rel="noopener">"Before / after" in the dashboard</a>
    </div>`;
  }

  function whyViralHtml(d) {
    const hooks = d.hooks || [];
    return `
      ${hooks.length ? `<div class="nf-hint"><b>Hooks:</b></div>
        <ul class="nf-why-list">${hooks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      ${d.title_pattern ? `<div class="nf-hint"><b>Title pattern:</b> ${esc(d.title_pattern)}</div>` : ''}
      ${d.timing_factor ? `<div class="nf-hint"><b>Publishing time:</b> ${esc(d.timing_factor)}</div>` : ''}
      ${d.replicable_formula ? `<div class="nf-hint"><b>Formula:</b> ${esc(d.replicable_formula)}</div>` : ''}
      <div class="nf-hint">confidence: ${Math.round((d.confidence || 0) * 100)}%</div>`;
  }

  function commentsHtml(data, videoPublishedAt) {
    const comments = data.comments || [];
    if (!comments.length) {
      return `<div class="nf-hint">No comments or they are disabled.</div>`;
    }
    let first24h = null;
    const pub = videoPublishedAt ? new Date(videoPublishedAt).getTime() : null;
    if (pub) {
      const cutoff = pub + 24 * 3600 * 1000;
      const early = comments.filter((c) => c.publishedAt && new Date(c.publishedAt).getTime() <= cutoff);
      first24h = `${early.length} of ${comments.length} loaded — within the first day after publication`;
    }
    return `
      ${first24h ? `<div class="nf-hint">${esc(first24h)}</div>` : ''}
      <div class="nf-comments-list">
        ${comments.slice(0, 30).map((c) => `<div class="nf-comment">
          <div class="nf-comment-h"><b>${esc(c.author || '')}</b>
            <span class="nf-hint">${compact(c.likeCount)} ♥ · ${ageText((Date.now() - new Date(c.publishedAt || Date.now()).getTime()) / 86400000)}</span></div>
          <div class="nf-comment-t">${esc((c.text || '').slice(0, 300))}</div>
        </div>`).join('')}
      </div>
      <div class="nf-hint">Loaded ${comments.length} — raw text, no sentiment analysis; read for yourself what people ask for and complain about.</div>`;
  }

  // ------------------------------------------------------- channel page

  const RISK_LEVEL = { low: 'low', medium: 'medium', high: 'high' };

  function riskRow(r) {
    if (!r || !r.found || r.level === 'insufficient-data') return '';
    const why = (r.reasons || []).map((x) => x.text).join('; ');
    return `<div class="nf-row"><span class="nf-muted">Template risk:</span>
      <b>${esc(RISK_LEVEL[r.level] || r.level)}</b> · ${r.score}/100
      <span class="nf-hint" title="${esc(why)}">${esc(why || 'no template signals stand out')}.
        A heuristic, not a YouTube decision.</span></div>`;
  }

  // Plan 06: revenue estimates -- ads only; the niche RPM range instead of a single number.
  const AD_ONLY = 'ads only, no sponsorship integrations';

  function nicheRpmRow(nm) {
    if (!nm || nm.monthly_usd_low == null || !nm.rpm_range) return '';
    const r = nm.rpm_range;
    return `<div class="nf-row"><span class="nf-muted">By niche RPM:</span>
      <b>$${decimal(nm.monthly_usd_low, 0)}–$${decimal(nm.monthly_usd_high, 0)}</b> per month
      <span class="nf-hint" title="${esc(r.basis || '')}">RPM $${decimal(r.low, 1)}–$${decimal(r.high, 1)} ·
        a rough range: RPM estimates for one niche differ by up to 7x</span></div>`;
  }

  // Plan 20: a mini chart -- views by age from snapshots, the dashed line is an ordinary
  // video of this channel at the same age (estimate). No libraries, own SVG.
  function sparkline(v) {
    const W = 300, H = 56, pad = 3;
    const x1 = Math.max(...v.points.map((p) => p.ageHours), 1);
    const inX = (pts) => pts.filter((p) => p.ageHours <= x1);
    const y1 = Math.max(...[...v.points, ...inX(v.expected)].map((p) => p.views), 1);
    const px = (h) => pad + (h / x1) * (W - 2 * pad);
    const py = (val) => H - pad - (val / y1) * (H - 2 * pad);
    const d = (pts) => inX(pts).map((p, i) => `${i ? 'L' : 'M'}${px(p.ageHours).toFixed(1)},${py(p.views).toFixed(1)}`).join('');
    const age = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-label="views by age">
        ${v.expected.length ? `<path d="${d(v.expected)}" fill="none" stroke="#898781" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
        <path d="${d(v.points)}" fill="none" stroke="#3987e5" stroke-width="2"/></svg>
      <div class="nf-hint">${v.points.length} ${plural(v.points.length, 'snapshot', 'snapshots')} · ${
        v.observedFromHours > 24 ? `observed from ${age(v.observedFromHours)} · ` : ''}up to ${age(x1)} · dashed line — an ordinary video of the channel (estimate)</div>`;
  }

  // YPP thresholds (plan 12) -- what is visible in public data, not a monetization status.
  function yppRow(e) {
    if (!e) return '';
    const seen = compact(e.tiers?.full?.shortsViews90d?.seenAtLeast || 0);
    const text = {
      'below-threshold': 'not reached (under 500 subscribers)',
      'subscribers-met': 'subscribers reached, watch hours cannot be known',
      'shorts-path-met': `reached via Shorts (≥${seen} in 90 days)`,
      unknown: 'unknown (subscribers hidden)',
    }[e.status] || e.status;
    // plan 17: from 01.02.2027 the full tier -- 8,000 hours or 20M Shorts views
    const next = e.upcoming ? ' · from 01.02.2027 the threshold is higher: 8,000 h or 20M Shorts'
      : e.rules === '2027' ? ' · 2027 rules' : '';
    return `<div class="nf-row"><span class="nf-muted">YPP threshold:</span> ${esc(text + next)}
      <span class="nf-hint" title="${esc(e.note || '')}">Not a monetization status: YouTube does not publish it.</span></div>`;
  }

  // Subscriber milestones (plan 17) -- a straight line at the pace of our snapshots, not YouTube data.
  function milestonesRow(ms) {
    const f = (ms?.forecasts || []).find((x) => !x.reached);
    if (!f) return '';
    const eta = f.eta30 || f.eta90;
    const text = eta ? `${compact(f.target)} ≈ ${new Date(eta).toLocaleDateString('en-US')}`
      : `${compact(f.target)}: cannot be estimated`;
    return `<div class="nf-row"><span class="nf-muted">Milestone:</span> ${esc(text)}
      <span class="nf-hint" title="${esc(ms.note || '')}">estimate from the snapshot pace</span></div>`;
  }

  function channelHtml(d, deep, risk) {
    const p = d.profile, m = d.metrics;
    const a = deep?.analytics?.found ? deep.analytics : null;
    const similar = (deep?.similar?.similar || []).slice(0, 5);
    const best = (deep?.bestTime?.best || []).slice(0, 4);
    const patterns = (deep?.patterns?.patterns || []).slice(0, 5);
    const outliers = (a?.topOutliers || []).slice(0, 5);

    const growthLine = m.subsGrowth
      ? `${m.subsGrowth.per_day > 0 ? '+' : ''}${compact(m.subsGrowth.per_day)} subscribers/day`
      : 'no growth visible yet — too few snapshots';

    return header('Channel', statusChip(d)) + `
      <div class="nf-body">
        <div class="nf-grid">
          ${cell('subscribers', p.subscribersHidden ? 'hidden' : compact(p.subscribers))}
          ${cell('total views', compact(p.totalViews))}
          ${cell('videos', compact(p.videoCount))}
          ${cell('average per video', compact(m.avgViewsPerVideo))}
          ${cell('channel age', ageText(p.ageDays))}
          ${cell('growth grade', m.grade || '—', 'Social Blade momentum: recent pace against lifetime')}
        </div>

        <div class="nf-row"><span class="nf-muted">Trend:</span> ${esc(growthLine)}
          <span class="nf-hint">${d.snapshots} ${plural(d.snapshots, 'snapshot', 'snapshots')}</span></div>
        ${riskRow(risk)}
        <div class="nf-policy"></div>
        ${yppRow(d.yppEligibility)}
        ${milestonesRow(d.milestones)}

        <div class="nf-row"><span class="nf-muted">Monthly revenue, estimate:</span>
          <b>$${decimal(m.revenue.low_usd, 0)}–$${decimal(m.revenue.high_usd, 0)}</b>
          <span class="nf-hint">Social Blade range · ${AD_ONLY}</span></div>
        ${nicheRpmRow(a?.revenue?.nicheModel)}
        <div class="nf-profit"></div>

        ${a ? `<div class="nf-row"><span class="nf-muted">Cadence:</span>
          ${decimal(a.cadence.uploadsPerWeekLifetime, 1)} videos/week ·
          Shorts ${decimal(a.cadence.shortsSharePercent, 0)}% ·
          last upload ${ageText(a.cadence.daysSinceLastUpload)} ago</div>` : ''}

        ${a?.profile?.aiLabels ? `<div class="nf-row"><span class="nf-muted">AI labels:</span>
          <span class="nf-chip">${esc(a.profile.aiLabels.isFaceless ? 'faceless' : 'on-camera')} · ${esc(a.profile.aiLabels.contentFormat)}</span></div>` : ''}

        ${outliers.length ? `<div class="nf-sec">
          <div class="nf-sec-h">Channel's best outliers</div>
          ${outliers.map((o) => `<a class="nf-item" href="/watch?v=${esc(o.videoId)}">
            <span class="nf-mult nf-band-${bandLevel(o.band)}">×${decimal(o.outlierScore, 1)}</span>
            <span class="nf-item-t">${esc(o.title)}</span>
            <span class="nf-hint">${compact(o.views)}</span></a>`).join('')}
        </div>` : ''}

        ${best.length ? `<div class="nf-sec">
          <div class="nf-sec-h">When to publish</div>
          <div class="nf-slots">${best.map((b) => `<span class="nf-slot" title="median outlier ×${decimal(b.medianOutlier, 2)}, sample ${b.samples}">
            ${esc(b.weekday)} ${String(b.hour).padStart(2, '0')}:00
            <b>${b.score}</b></span>`).join('')}</div>
          <div class="nf-hint">The score is relative, the best slot = 100. Time is in your time zone. Correlation, not cause.</div>
        </div>` : ''}

        ${patterns.length ? `<div class="nf-sec">
          <div class="nf-sec-h">Title phrases that more often produce an outlier</div>
          ${patterns.map((x) => `<div class="nf-item">
            <span class="nf-mult">×${decimal(x.outlierLift, 1)}</span>
            <span class="nf-item-t">${esc(x.keyword)}</span>
            <span class="nf-hint">${x.videos} ${plural(x.videos, 'video', 'videos')}</span></div>`).join('')}
        </div>` : ''}

        ${similar.length ? `<div class="nf-sec">
          <div class="nf-sec-h">Similar channels</div>
          ${similar.map((s) => `<a class="nf-item" href="/channel/${esc(s.channelId)}">
            <span class="nf-item-t">${esc(s.title || s.channelId)}</span>
            <span class="nf-hint">${compact(s.subscriberCount)} · ${decimal(s.similarity * 100, 0)}%</span></a>`).join('')}
        </div>` : ''}

        ${!d.hasDeepAnalytics ? `<div class="nf-hint">
          The database has ${d.stored.count} ${plural(d.stored.count, 'video', 'videos')} of this channel — for outliers, publishing time and
          patterns at least 5 are needed. Press "Collect channel".</div>` : ''}

        <div class="nf-actions">
          <button class="nf-btn nf-collect">${d.stored.count ? 'Refresh the channel in the database' : 'Collect the channel (100 videos)'}</button>
          <button class="nf-btn nf-track">${d.tracked ? 'Untrack' : 'Track'}</button>
          <button class="nf-btn nf-ghost nf-save">Save</button>
          <a class="nf-btn nf-ghost nf-dash" target="_blank" rel="noopener">Dashboard</a>
        </div>
      </div>`;
  }

  async function renderChannel(ref, opts = {}) {
    const mount = await waitFor('#page-header, #channel-header, ytd-two-column-browse-results-renderer');
    if (!mount || channelRef() !== ref) return;
    const root = ensurePanel(mount, 'nf-panel-channel', 'after');
    root.innerHTML = skeleton('analysing the channel…');

    const res = await send({ type: 'channel', ref, refresh: !!opts.refresh });
    if (!root.isConnected || channelRef() !== ref) return;

    if (!res.ok) {
      root.innerHTML = errorHtml(res);
      wireCommon(root, () => renderChannel(ref, { refresh: true }));
      return;
    }
    const d = res.data;
    if (!d.found) {
      root.innerHTML = notFoundHtml(d, 'channel');
      wireCommon(root, () => renderChannel(ref, { refresh: true }));
      return;
    }

    let deep = null;
    if (d.hasDeepAnalytics) {
      const dr = await send({ type: 'deep', channelId: d.channelId });
      if (dr.ok) deep = dr.data;
      if (!root.isConnected || channelRef() !== ref) return;
    }

    let risk = null;
    if (d.hasDeepAnalytics) {
      const rr = await send({ type: 'templateRisk', channelId: d.channelId });
      if (rr.ok) risk = rr.data;
      if (!root.isConnected || channelRef() !== ref) return;
    }

    root.innerHTML = channelHtml(d, deep, risk);
    wireCommon(root, () => renderChannel(ref, { refresh: true }));

    // plan 30: net profit per month for the first cost profile
    send({ type: 'profit', channelId: d.channelId }).then((pr) => {
      const box = root.querySelector('.nf-profit');
      const mo = pr.ok && pr.data?.found ? pr.data.month : null;
      if (!box || !mo) return;
      const label = { profitable: 'profitable', loss: 'loss-making', uncertain: 'unclear' }[mo.verdict] || mo.verdict;
      const prof = pr.data.profile?.name ? `profile “${pr.data.profile.name}”` : 'no costs — add a profile in the dashboard';
      box.innerHTML = `<div class="nf-row"><span class="nf-muted">Monthly profit:</span>
        <b>$${decimal(mo.profit.low, 0)}–$${decimal(mo.profit.high, 0)}</b> (${esc(label)})
        <span class="nf-hint">${esc(prof)} · costs $${decimal(mo.cost, 0)}${pr.data.yppWarning ? ' · below the full YPP: ads may not pay' : ''}</span></div>`;
    });

    // plan 22: monetization-policy signals -- in one line, without a risk percentage
    if (d.hasDeepAnalytics) {
      send({ type: 'policySignals', channelId: d.channelId }).then((ps) => {
        const box = root.querySelector('.nf-policy');
        if (!box || !ps.ok || !ps.data?.found) return;
        const names = { generic_repetitive: 'templated', unsatisfying: 'shock titles',
          ai_persona_sensitive: 'AI persona on a sensitive topic' };
        const flagged = Object.entries(ps.data.categories)
          .filter(([, c]) => c.level === 'high' || c.level === 'watch')
          .map(([k, c]) => `${names[k]}${c.level === 'high' ? ' (clear)' : ''}`);
        box.innerHTML = `<div class="nf-row"><span class="nf-muted">Monetization rules:</span>
          ${esc(flagged.length ? flagged.join(', ') : 'no signals')}
          <span class="nf-hint" title="${esc(ps.data.note || '')}">signals from public data, not a YouTube decision</span></div>`;
      });
    }

    const dash = root.querySelector('.nf-dash');
    if (dash) dash.href = (SETTINGS?.baseUrl || 'http://127.0.0.1:8080');

    const collect = root.querySelector('.nf-collect');
    if (collect) collect.addEventListener('click', async () => {
      collect.disabled = true; collect.textContent = 'Collecting…';
      const r = await send({ type: 'collect', channel: d.channelId, maxVideos: 100 });
      collect.textContent = r.ok ? `Done: ${r.data.videos_stored} videos` : 'Error';
      setTimeout(() => renderChannel(ref, { refresh: true }), 1200);
    });

    const track = root.querySelector('.nf-track');
    if (track) track.addEventListener('click', async () => {
      track.disabled = true;
      const r = await send({ type: d.tracked ? 'untrack' : 'track', channelId: d.channelId });
      track.disabled = false;
      if (r.ok) { d.tracked = !d.tracked; track.textContent = d.tracked ? 'Untrack' : 'Track'; }
    });

    const save = root.querySelector('.nf-save');
    if (save) save.addEventListener('click', async () => {
      save.disabled = true;
      const r = await send({ type: 'save', kind: 'channel', refId: d.channelId, payload: d });
      save.textContent = r.ok ? 'Saved' : 'Error';
      setTimeout(() => { save.disabled = false; save.textContent = 'Save'; }, 1500);
    });
  }

  // ------------------------------------------- badges on video cards

  const seen = new Map();     // videoId -> a set of thumbnails (one video can appear in several blocks)
  let queue = new Set();
  let flushTimer = null;
  const resultsInfo = new Map();   // videoId -> info, only on /results, for the results summary
  let summaryTimer = null;

  function videoIdFromHref(href) {
    if (!href) return null;
    const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  const cardObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      cardObserver.unobserve(e.target);
      const id = e.target.dataset.nfVid;
      if (id && !e.target.dataset.nfDone) queue.add(id);
    }
    scheduleFlush();
  }, { rootMargin: '200px' });

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 500);
  }

  async function flush() {
    flushTimer = null;
    if (!SETTINGS?.showBadges || !queue.size) { queue.clear(); return; }
    const ids = [...queue].slice(0, 40);
    queue = new Set([...queue].slice(40));
    const res = await send({ type: 'batch', ids });
    if (res.ok) {
      for (const [id, info] of Object.entries(res.data.results || {})) applyBadge(id, info);
      if (location.pathname === '/results') {
        for (const [id, info] of Object.entries(res.data.results || {})) {
          if (info && info.found) resultsInfo.set(id, info);
        }
        scheduleSummaryRender();
      }
    }
    if (queue.size) scheduleFlush();
  }

  // ------------------------------------------------- summary on the results page

  function median(sorted) {
    const n = sorted.length;
    if (!n) return null;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }

  function resultsSummaryHtml(list) {
    const total = list.length;
    const withScore = list.filter((v) => v.outlierScore != null);
    const outliers = withScore.filter((v) => v.outlierScore >= 2);
    const views = list.map((v) => v.views).filter((v) => v != null).sort((a, b) => a - b);
    const ages = list.map((v) => v.ageDays).filter((v) => v != null).sort((a, b) => a - b);
    const subs = list.map((v) => v.subscribers).filter((v) => v != null).sort((a, b) => a - b);
    const channels = new Set(list.map((v) => v.channelId).filter(Boolean));
    const shortsShare = total ? Math.round(list.filter((v) => v.isShort).length / total * 100) : 0;
    const medianViews = median(views), medianAge = median(ages), medianSubs = median(subs);

    return `
      <div class="nf-head">
        <div class="nf-logo">niche&#8209;finder</div>
        <div class="nf-sub">Results summary · ${total} ${plural(total, 'video', 'videos')} checked</div>
      </div>
      <div class="nf-body">
        <div class="nf-grid">
          ${cell('outliers (×≥2)', total ? `${outliers.length} of ${withScore.length}` : '—')}
          ${cell('median views', medianViews != null ? compact(medianViews) : '—')}
          ${cell('median age', medianAge != null ? ageText(medianAge) : '—')}
          ${cell('Shorts', total ? shortsShare + '%' : '—')}
          ${cell('channels in results', channels.size || '—')}
          ${cell('median subscribers', medianSubs != null ? compact(medianSubs) : '—')}
        </div>
        <div class="nf-hint">Computed from the badges already loaded — scroll the feed to capture more cards.</div>
      </div>`;
  }

  async function renderResultsSummary() {
    if (location.pathname !== '/results') return;
    const mount = await waitFor('ytd-two-column-search-results-renderer #primary, #primary');
    if (!mount || location.pathname !== '/results') return;
    const root = ensurePanel(mount, 'nf-panel-results', 'prepend');
    root.innerHTML = resultsSummaryHtml([...resultsInfo.values()]);
  }

  function scheduleSummaryRender() {
    if (summaryTimer) return;
    summaryTimer = setTimeout(() => { summaryTimer = null; renderResultsSummary(); }, 400);
  }

  function applyBadge(videoId, info) {
    const anchors = seen.get(videoId);
    if (!anchors) return;
    for (const anchor of anchors) {
      if (!anchor.isConnected) continue;
      anchor.dataset.nfDone = '1';
      anchor.querySelectorAll('.nf-badge').forEach((b) => b.remove());
      if (!info || !info.found || info.outlierScore == null) continue;
      if (SETTINGS.onlyOutliers && info.outlierScore < 1.5) continue;

      const badge = document.createElement('span');
      badge.className = 'nf-badge nf-band-' + bandLevel(info.outlierBand);
      badge.textContent = '×' + decimal(info.outlierScore, info.outlierScore < 10 ? 1 : 0);
      badge.title = [
        info.channelTitle || '',
        `${compact(info.views)} views · ${ageText(info.ageDays)}`,
        info.viewsPerSubscriber != null ? `×${decimal(info.viewsPerSubscriber, 2)} per subscriber` : '',
        `${bandName(info.outlierBand)} relative to the channel average`,
      ].filter(Boolean).join('\n');
      if (getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
      anchor.appendChild(badge);

      if (SETTINGS.showVph) {
        const vph = info.vph24h != null ? info.vph24h : info.vphLifetime;
        if (vph != null && vph > 0) {
          const vBadge = document.createElement('span');
          vBadge.className = 'nf-badge nf-badge-vph';
          vBadge.textContent = compact(vph) + '/h';
          vBadge.title = info.vph24h != null
            ? 'views per hour over the last 24 hours (our snapshots)'
            : 'views per hour averaged over all time — there is no snapshot history yet';
          anchor.appendChild(vBadge);
        }
      }
    }
  }

  /* One card — one badge. We find cards by the names of custom elements
     (ytd-video-renderer, yt-lockup-view-model etc.): they change noticeably
     less often than CSS classes, which YouTube renames every couple of releases.
     Inside a card we take the thumbnail link, not the title or the chapters from the description
     — otherwise up to eight badges land on one video. */
  const CARD_CONTAINERS = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-video-renderer', 'yt-lockup-view-model',
    'ytm-shorts-lockup-view-model', 'ytd-reel-item-renderer',
  ].join(', ');
  const THUMB_INSIDE = 'img, yt-image, ytd-thumbnail, .ytThumbnailViewModelHost';

  function pickThumbAnchor(card) {
    const list = [...card.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')]
      .filter((a) => a.querySelector(THUMB_INSIDE));
    if (!list.length) return null;
    return list.find((a) => a.id === 'thumbnail')
      || list.sort((x, y) => y.getBoundingClientRect().width - x.getBoundingClientRect().width)[0];
  }

  function scanCards() {
    if (!SETTINGS?.showBadges) return;
    for (const card of document.querySelectorAll(CARD_CONTAINERS)) {
      const anchor = pickThumbAnchor(card);
      if (!anchor) continue;
      const id = videoIdFromHref(anchor.getAttribute('href'));
      if (!id) continue;
      if (card.dataset.nfCard === id) continue;   // do not take the same card a second time
      card.dataset.nfCard = id;                   // but one reused by the feed — take it
      anchor.dataset.nfVid = id;
      delete anchor.dataset.nfDone;
      anchor.querySelectorAll('.nf-badge').forEach((b) => b.remove());
      if (!seen.has(id)) seen.set(id, new Set());
      seen.get(id).add(anchor);
      cardObserver.observe(anchor);
    }
  }

  // The feed loads in batches — scanning on every DOM change is expensive.
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scanCards(); }, 400);
  }

  // ------------------------------------------------------- routing

  function getVideoId() {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  }

  function channelRef() {
    const p = location.pathname;
    if (!/^\/(channel|c|user|@)/.test(p)) return null;
    const canon = document.querySelector('link[rel="canonical"]');
    const fromCanon = canon && canon.href.match(/channel\/(UC[\w-]{20,})/);
    if (fromCanon) return fromCanon[1];                 // a UC-id spends no quota on resolving
    let m = p.match(/^\/channel\/(UC[\w-]+)/); if (m) return m[1];
    m = p.match(/^\/(@[^/?#]+)/); if (m) return decodeURIComponent(m[1]);
    m = p.match(/^\/(?:c|user)\/([^/?#]+)/); if (m) return decodeURIComponent(m[1]);
    return null;
  }

  async function route() {
    SETTINGS = (await send({ type: 'settings:get' })).data || SETTINGS;
    const key = location.pathname + location.search;
    if (key === currentKey) { scanCards(); return; }
    currentKey = key;
    removePanels();
    seen.clear(); queue.clear(); resultsInfo.clear();

    const videoId = getVideoId();
    if (videoId && location.pathname === '/watch') {
      renderWatch(videoId);
    } else if (location.pathname === '/results') {
      renderResultsSummary();
    } else {
      const ref = channelRef();
      if (ref) renderChannel(ref);
    }
    scanCards();
  }

  // YouTube sends its own event after every SPA navigation; the interval is a safety net
  // in case the event is changed or the page opens without it.
  window.addEventListener('yt-navigate-finish', () => setTimeout(route, 60));
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) { lastHref = location.href; route(); }
  }, 900);

  // New cards are appended by the infinite feed — we catch them selectively.
  const listObserver = new MutationObserver(() => scheduleScan());
  listObserver.observe(document.documentElement, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener(async () => {
    SETTINGS = (await send({ type: 'settings:get' })).data || SETTINGS;
    document.querySelectorAll('.nf-badge').forEach((b) => b.remove());
    document.querySelectorAll('[data-nf-done]').forEach((el) => delete el.dataset.nfDone);
    document.querySelectorAll('[data-nf-card]').forEach((el) => delete el.dataset.nfCard);
    currentKey = '';
    route();
  });

  route();
})();
