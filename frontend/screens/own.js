/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, num, compact, ago, esc, toast, tile, sectionHead, notice, empty, table, mountCollabs } from '../ui.js';
import { view } from '../shared.js';

/* ------------------------------------------------ My channels (plan 14)
   Real numbers of your own channels from YouTube Analytics via OAuth. The token
   is stored encrypted on the server and never reaches here. */

const POSITION = {
  below: ['below our estimate', 'chip-warn'],
  inside: ['within the estimate', 'chip-good'],
  above: ['above our estimate', 'chip-good'],
  unknown: ['unknown', ''],
};

function money(x) { return x == null ? '—' : `$${num(Math.round(x * 100) / 100)}`; }
function pct(x) { return x == null ? '—' : `${num(x)}%`; }

/* Plan 25: for a service client -- only "not set up yet"; for the administrator in
   web mode -- the steps for one service OAuth client of type Web application. */
function setupHtml(st) {
  if (st.adminOnly) {
    return `<div class="card">${sectionHead('Connecting channels is not available yet', '')}
      <div class="section-sub">The service administrator has not set up Google sign-in yet. Check back later.</div></div>`;
  }
  if (st.mode === 'web') return webSetupHtml(st);
  return `<div class="card">
    ${sectionHead('Connection is not set up', 'once: your own Google OAuth client and an encryption key')}
    <div class="prose">
      <p>Variables missing in <code>.env</code>: ${st.missing.map((m) => `<code>${esc(m)}</code>`).join(', ')}.</p>
      <ol>
        <li>In <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> create a project,
          enable <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li>
        <li>OAuth consent screen: type External, mode Testing, add your Google account to the test users.</li>
        <li>Credentials → Create credentials → OAuth client ID → type <b>Desktop app</b>. Copy the Client ID and Client secret
          into <code>OWN_OAUTH_CLIENT_ID</code> and <code>OWN_OAUTH_CLIENT_SECRET</code>.</li>
        <li>Generate a token encryption key and put it in <code>OWN_TOKENS_KEY</code>:
          <pre><code>docker compose run --rm web python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"</code></pre>
          Keep the key only in <code>.env</code>: without it the saved tokens cannot be read and you will have to connect the channel again.</li>
        <li>Restart: <code>docker compose up -d web worker</code>.</li>
      </ol>
      <p>After sign-in Google will return you to the same dashboard address (<code>/api/own/oauth/callback</code>) — for a client
        of type Desktop app it does not need to be registered separately. Finish the sign-in in the same browser where you started. Details are in <code>backend/README.md</code>, section "Your own channels".</p>
    </div></div>`;
}

function webSetupHtml(st) {
  const list = (xs) => xs.map((m) => `<code>${esc(m)}</code>`).join(', ');
  return `<div class="card">
    ${sectionHead('Connecting channels for clients is not set up', 'service mode: one Google OAuth client for all clients')}
    <div class="prose">
      ${st.missing?.length ? `<p>Variables missing in <code>.env</code>: ${list(st.missing)}.</p>` : ''}
      ${st.problems?.length ? `<p>${st.problems.map(esc).join('<br>')}</p>` : ''}
      <ol>
        <li>In Google Cloud Console enable <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li>
        <li>OAuth consent screen: type External; the service name, domain, links to <code>https://&lt;domain&gt;/privacy</code> and
          <code>https://&lt;domain&gt;/terms</code> (the service already serves these pages). Scopes: <code>youtube.readonly</code>,
          <code>yt-analytics.readonly</code> and, if clients want to see revenue, <code>yt-analytics-monetary.readonly</code>.</li>
        <li>Credentials → OAuth client ID → type <b>Web application</b>. In Authorized redirect URIs enter
          <code>${esc(st.redirectUri || 'https://<domain>/api/own/oauth/callback')}</code> — the same as in <code>OWN_OAUTH_REDIRECT_URI</code>.</li>
        <li>In <code>.env</code>: <code>OWN_OAUTH_MODE=web</code>, <code>OWN_OAUTH_CLIENT_ID</code>, <code>OWN_OAUTH_CLIENT_SECRET</code>,
          <code>OWN_OAUTH_REDIRECT_URI</code>, <code>OWN_TOKENS_KEY</code>, and for the policy pages — <code>NF_SERVICE_NAME</code>,
          <code>NF_OPERATOR_NAME</code>, <code>NF_CONTACT_EMAIL</code>.</li>
        <li>Until Google verifies the app, only test users (up to 100) can connect, and Google shows
          "app not verified". Verification needs a domain, these pages, a demo video and an explanation of each scope.</li>
      </ol>
      <p>Clients do not see these steps: they only see the "Connect channel" button.</p>
    </div></div>`;
}

function channelsHtml(d, cal) {
  const byId = Object.fromEntries((cal.channels || []).map((c) => [c.channelId, c]));
  return `<div class="card">
    ${sectionHead('My channels', 'real numbers for 28 days, ending 3 days ago (Analytics delay)',
      `<label class="field" data-tip="Channel revenue and RPM: Google will ask for separate access to monetary reports. It can be added later">
         <input type="checkbox" id="ownRevenue"${d.mode === 'web' ? '' : ' checked'}> show revenue</label>
       <button class="btn btn-sm" id="ownConnect" type="button">Connect channel</button>
       <button class="btn btn-ghost btn-sm" id="ownSync" type="button">Refresh numbers</button>`)}
    ${d.channels.length ? table([
      { label: 'Channel', wrap: true, render: (c) => `<a href="#/channel/${esc(c.channelId)}">${esc(c.title || c.channelId)}</a>
        ${c.lastError ? `<div class="row-sub" style="color:var(--bad, #c55)">${esc(c.lastError)}</div>` : ''}` },
      { label: 'Views', num: true, render: (c) => compact(c.last28d.views) },
      { label: 'Revenue', num: true, render: (c) => money(c.last28d.revenue) },
      { label: 'RPM', num: true, render: (c) => money(c.last28d.rpm) },
      { label: 'Retention', num: true, render: (c) => pct(c.last28d.medianRetentionPct) },
      { label: 'Our RPM estimate', render: (c) => {
        const k = byId[c.channelId];
        if (!k) return '—';
        const [label, cls] = POSITION[k.position] || [k.position, ''];
        return `<span class="chip ${cls}">${esc(label)}</span>
          <div class="row-sub">${money(k.estimate.low)}–${money(k.estimate.high)}</div>`;
      } },
      { label: 'Updated', render: (c) => (c.lastSyncedAt ? ago(c.lastSyncedAt) : '—') },
      { label: '', render: (c) => `${c.monetaryScope ? '' : `<button class="btn btn-ghost btn-sm js-own-revenue" type="button"
          data-tip="Google will ask for access to this channel's monetary reports">Add revenue</button> `}<button class="btn btn-ghost btn-sm js-own-off" data-id="${esc(c.channelId)}" type="button">Disconnect</button>` },
    ], d.channels) : empty('no channels yet — press "Connect channel"')}
    <div class="section-sub" style="margin-top:10px">${esc(d.note)} RPM = revenue per 1,000 of all views, as in YouTube Studio;
      without monetization revenue is empty. Retention is the median of the average view percentage across videos.</div>
  </div>
  ${d.channels.length ? `<div class="card">
    ${sectionHead('Formats', 'Shorts versus long videos and hours towards the YPP threshold — from YouTube Analytics',
      `<select id="ownFmtChannel">${d.channels.map((c) => `<option value="${esc(c.channelId)}">${esc(c.title || c.channelId)}</option>`).join('')}</select>`)}
    <div id="ownFmtOut">${empty('Calculating…')}</div>
  </div>` : ''}
  ${d.channels.length ? `<div class="card" id="ownVsCard">
    ${sectionHead('My videos versus the niche', 'lifetime views and retention of your videos versus the niche\'s collected videos',
      `<select id="ownVsChannel">${d.channels.map((c) => `<option value="${esc(c.channelId)}">${esc(c.title || c.channelId)}</option>`).join('')}</select>
       <select id="ownVsNiche"><option value="">niche…</option></select>`)}
    <div id="ownVsOut">${empty('pick a niche')}</div>
  </div>` : ''}
  ${d.channels.length ? `<div class="card">
    ${sectionHead('Collaboration partners', 'similar channels of your size among the collected ones',
      `<select id="ownCollabChannel">${d.channels.map((c) => `<option value="${esc(c.channelId)}">${esc(c.title || c.channelId)}</option>`).join('')}</select>`)}
    <div id="ownCollabOut"></div>
  </div>` : ''}`;
}

function vsHtml(v) {
  return `<div class="tiles">
      ${tile('Median of my videos', compact(v.ownMedianViews), `${num(v.ownVideos)} videos`)}
      ${tile('Niche median', compact(v.nicheMedianViews), `${num(v.nicheVideos)} videos in the database`)}
      ${tile('Ratio', v.ratio == null ? '—' : `×${v.ratio}`, 'mine to niche')}
      ${tile('Above the niche median', v.shareAboveNicheMedian == null ? '—' : `${Math.round(v.shareAboveNicheMedian * 100)}%`, 'of my videos')}
      ${tile('Retention', pct(v.ownMedianRetentionPct), 'median of my videos')}
    </div>
    ${v.topVideos.length ? table([
      { label: 'Video', render: (r) => `<a href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">${esc(r.videoId)}</a>` },
      { label: 'Views', num: true, render: (r) => compact(r.views) },
      { label: 'Retention', num: true, render: (r) => pct(r.averageViewPercentage) },
      { label: 'RPM', num: true, render: (r) => money(r.rpm) },
    ], v.topVideos) : ''}
    <div class="section-sub">${esc(v.note)}</div>`;
}

function wire() {
  const connect = $('#ownConnect');
  if (connect) connect.addEventListener('click', async () => {
    connect.disabled = true;
    try {
      const r = await api('/api/own/connect', { method: 'POST', body: { includeRevenue: !!$('#ownRevenue')?.checked } });
      window.location.href = r.authUrl;
    } catch (e) { connect.disabled = false; toast(e.message, 'err'); }
  });
  // plan 25: revenue -- a separate consent, for an already connected channel
  document.querySelectorAll('.js-own-revenue').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const r = await api('/api/own/connect', { method: 'POST', body: { includeRevenue: true } });
      window.location.href = r.authUrl;
    } catch (e) { b.disabled = false; toast(e.message, 'err'); }
  }));
  const sync = $('#ownSync');
  if (sync) sync.addEventListener('click', async () => {
    sync.disabled = true; sync.textContent = 'Refreshing…';
    try {
      const r = await api('/api/own/sync', { method: 'POST' });
      const bad = r.channels.filter((c) => c.error);
      toast(bad.length ? `Not refreshed: ${bad.map((c) => c.error).join('; ')}` : 'Numbers refreshed', bad.length ? 'err' : 'ok');
      viewOwn();
    } catch (e) { sync.disabled = false; sync.textContent = 'Refresh numbers'; toast(e.message, 'err'); }
  });
  view.querySelectorAll('.js-own-off').forEach((btn) => btn.addEventListener('click', async () => {
    // A double press instead of confirm(): browser dialogs block the page.
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Really disconnect?'; return; }
    btn.disabled = true;
    try {
      const r = await api(`/api/own/channels/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
      toast(r.revoked ? 'Channel disconnected, access revoked at Google' : 'Channel disconnected; access can also be removed at myaccount.google.com/permissions', 'ok');
      viewOwn();
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  }));
  const nicheSel = $('#ownVsNiche');
  if (nicheSel) {
    api('/api/niches').then((d) => {
      nicheSel.innerHTML += (d.niches || []).map((n) => `<option value="${esc(n.slug)}">${esc(n.slug)}</option>`).join('');
    }).catch(() => {});
    const load = async () => {
      const out = $('#ownVsOut');
      if (!nicheSel.value) { out.innerHTML = empty('pick a niche'); return; }
      out.innerHTML = empty('Calculating…');
      try {
        const v = await api(`/api/own/channels/${encodeURIComponent($('#ownVsChannel').value)}/vs-niche?niche=${encodeURIComponent(nicheSel.value)}`);
        out.innerHTML = vsHtml(v);
      } catch (e) { out.innerHTML = notice(esc(e.message)); }
    };
    nicheSel.addEventListener('change', load);
    $('#ownVsChannel').addEventListener('change', load);
  }
}

/* Plan 24: formats of your own channel (creatorContentType) and watch hours over a year. */
const FORMAT = { SHORTS: 'Shorts', VIDEO_ON_DEMAND: 'Long', LIVE_STREAM: 'Live streams', STORY: 'Stories', UNSPECIFIED: 'Other' };
const READING = {
  'move-together': 'weeks with many Shorts views are also weeks with many long-video views',
  'move-apart': 'when Shorts views grow, long-video views sag',
  'no-clear-link': 'there is no clear link between Shorts and long-video views',
};

function formatsHtml(f) {
  if (!f.available) return empty(f.hint || 'no format data yet — it will arrive with the next refresh');
  const types = Object.entries(f.last90).sort((a, b) => b[1].views - a[1].views);
  const h = f.watchHours;
  const d = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US') : null);
  const bar = (need, reached, eta) => (reached ? `${num(need)} h — reached`
    : eta ? `${num(need)} h ≈ ${d(eta)} at a pace of ${num(h.paceHoursPerDay)} h/day` : `${num(need)} h — cannot be estimated at the current pace`);
  const sv = f.shortsVsLong;
  return `<div class="tiles">${types.map(([k, t]) => tile(FORMAT[k] || k, compact(t.views),
      `${Math.round((t.viewShare || 0) * 100)}% of views · ${t.subscribersPer1000Views ?? '—'} subs per 1000`)).join('')}</div>
    <div class="section-sub" style="margin-top:8px">Over 90 days through ${esc(d(f.through))}. "Subs per 1000" is how many subscribers
      each thousand views of this format brings.</div>
    <div class="section-sub" style="margin-top:8px"><b>Shorts and long videos:</b> ${sv.r == null
      ? (sv.reason === 'few-weeks' ? 'too few weeks to conclude' : 'views barely changed — no conclusion')
      : `${esc(READING[sv.reading] || sv.reading)} (r = ${sv.r} over ${sv.weeks} weeks). This is a correlation, not a cause.`}</div>
    <div class="section-sub" style="margin-top:8px"><b>Watch hours over 365 days:</b> ${num(Math.round(h.hours365))} h
      (long videos and streams; Shorts over 90 days — ${compact(h.shortsViews90d)} views).
      ${bar(4000, h.reached4000, h.eta4000)}; from 01.02.2027 — ${bar(8000, h.reached8000, h.eta8000)}.
      Approximate: these are not YouTube's "qualified watch hours".</div>`;
}

async function loadFormats() {
  const sel = $('#ownFmtChannel');
  const out = $('#ownFmtOut');
  if (!sel || !out) return;
  try { out.innerHTML = formatsHtml(await api(`/api/own/channels/${encodeURIComponent(sel.value)}/formats`)); }
  catch (e) { out.innerHTML = notice(esc(e.message)); }
}

async function viewOwn() {
  const params = new URLSearchParams((location.hash.split('?')[1]) || '');
  const flash = params.get('connected')
    ? notice(`Channel “${esc(params.get('connected'))}” connected.`, 'ok')
    : params.get('error') ? notice(`<b>Connection failed.</b> ${esc(params.get('error'))}`, 'error') : '';
  const st = await api('/api/own/status');
  if (!st.configured) { view.innerHTML = flash + setupHtml(st); return; }
  const [d, cal] = await Promise.all([api('/api/own/channels'), api('/api/own/rpm-calibration').catch(() => ({}))]);
  view.innerHTML = flash + channelsHtml({ ...d, mode: st.mode }, cal);
  wire();
  $('#ownFmtChannel')?.addEventListener('change', loadFormats);
  loadFormats();
  // plan 31: partners for the selected own channel
  const collabSel = $('#ownCollabChannel');
  if (collabSel) {
    const loadCollabs = () => mountCollabs($('#ownCollabOut'), collabSel.value, { bare: true });
    collabSel.addEventListener('change', loadCollabs);
    loadCollabs();
  }
}

export { viewOwn };
