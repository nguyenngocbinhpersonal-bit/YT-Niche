const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (res) => r(res || { ok: false, error: 'no response' })));
const $ = (id) => document.getElementById(id);
const compact = (n) => n == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(n);

async function load() {
  const s = (await send({ type: 'settings:get' })).data;
  $('baseUrl').value = s.baseUrl;
  $('apiToken').placeholder = s.apiToken ? 'token saved — enter a new one to replace it' : 'nf_…';
  $('autoFetch').checked = s.autoFetch;
  $('showBadges').checked = s.showBadges;
  $('onlyOutliers').checked = s.onlyOutliers;
  $('showVph').checked = s.showVph;
  $('dash').href = s.baseUrl;
  checkHealth();
}

async function save() {
  await send({ type: 'settings:set', patch: {
    baseUrl: $('baseUrl').value.trim() || 'http://127.0.0.1:8080',
    autoFetch: $('autoFetch').checked,
    showBadges: $('showBadges').checked,
    onlyOutliers: $('onlyOutliers').checked,
    showVph: $('showVph').checked,
    // an empty field means "leave unchanged"; a new token replaces the old one
    ...($('apiToken').value.trim() ? { apiToken: $('apiToken').value.trim() } : {}),
  }});
  $('apiToken').value = '';
  $('dash').href = $('baseUrl').value.trim();
  checkHealth();
}

async function checkHealth() {
  const box = $('status');
  box.className = 'status';
  box.textContent = 'checking the connection…';
  const res = await send({ type: 'health' });
  if (!res.ok) {
    box.className = 'status err';
    box.textContent = res.error;
    return;
  }
  const h = res.data;
  box.className = 'status ok';
  box.textContent = `backend is up · ${compact(h.db.videos)} videos, ${compact(h.db.channels)} channels in the database`
    + (h.hasApiKey ? ` · search calls left: ${h.searchQuota.callsLeft}` : ' · YouTube API key not set');
}

// ------------------------------------------------------------ alerts (8.9)

const ALERT_KIND_LABEL = {
  outlier: 'new outlier', acceleration: 'accelerating', title_change: 'changed title',
  silence_break: 'back after a pause', channel_gone: 'channel gone',
  video_gone: 'video gone', milestone: 'subscriber milestone', topic_match: 'your topic',
};

function alertLine(ev) {
  const p = ev.payload || {};
  let text;
  if (ev.kind === 'outlier') text = `“${p.title || p.videoId}” -- ×${p.outlierScore}, ${compact(p.views)} views`;
  else if (ev.kind === 'acceleration') text = `“${p.title || p.videoId}” -- acceleration ×${p.acceleration}`;
  else if (ev.kind === 'title_change') text = `“${p.oldTitle}” → “${p.newTitle}”`;
  else if (ev.kind === 'silence_break') text = `“${p.title || p.videoId}” -- pause of ${p.gapDays} d`;
  else if (ev.kind === 'channel_gone') text = `“${p.title || p.channelId}” -- had ${compact(p.subscribers)} subscribers`;
  else if (ev.kind === 'topic_match') text = `“${p.topic}”: “${p.title || p.videoId}”`;
  else if (ev.kind === 'milestone') text = `“${p.title || p.channelId}” -- ${compact(p.milestone)} subscribers`;
  else if (ev.kind === 'video_gone') text = `“${p.title || p.videoId}” -- was outlier ×${p.outlierScore}`;
  else text = JSON.stringify(p);
  return `<div class="md-sig ${ev.seenAt ? 'unreliable' : 'warn'}">${escHtml(ALERT_KIND_LABEL[ev.kind] || ev.kind)}: ${escHtml(text)}</div>`;
}

async function loadAlerts() {
  const res = await send({ type: 'events', unseenOnly: false });
  const box = $('alertsBody');
  const countEl = $('alertsCount');
  if (!res.ok) { box.innerHTML = `<div class="md-sig warn">${escHtml(res.error)}</div>`; return; }
  const { events, unseenCount } = res.data;
  countEl.textContent = unseenCount > 0 ? `(${unseenCount})` : '';
  box.innerHTML = events.length
    ? events.slice(0, 20).map(alertLine).join('')
    : '<div class="md-summary">no events yet -- at least one tracked channel and some time for the worker are needed</div>';
}

async function scanAlertsNow() {
  $('alertsBody').innerHTML = '<div class="md-summary">checking…</div>';
  const res = await send({ type: 'eventsScan' });
  if (!res.ok) { $('alertsBody').innerHTML = `<div class="md-sig warn">${escHtml(res.error)}</div>`; return; }
  await loadAlerts();
}

async function markAlertsSeen() {
  await send({ type: 'eventsSeen', all: true });
  await loadAlerts();
}

// ------------------------------------------------------- metadata review

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let mdLastReview = null;

function mdReadForm() {
  return {
    title: $('mdTitle').value.trim(),
    description: $('mdDesc').value,
    tags: $('mdTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    niche: $('mdNiche').value.trim() || null,
    channelId: $('mdChannel').value.trim() || null,
    isShort: $('mdShort').checked,
  };
}

function mdRenderResult(res) {
  mdLastReview = res;
  const box = $('mdResult');
  if (res.hint) {
    box.innerHTML = `<div class="md-summary">${escHtml(res.hint)}</div>`;
    return;
  }
  const s = res.summary;
  const sigHtml = res.signals.map((sig) => `<div class="md-sig ${sig.verdict}">${escHtml(sig.explanation)}</div>`).join('');
  const dupHtml = res.nearDuplicates.near && res.nearDuplicates.near.length
    ? `<div class="md-summary">Similar to: ${res.nearDuplicates.near.slice(0, 3)
        .map((d) => escHtml(d.title || d.videoId)).join('; ')}</div>`
    : '';
  box.innerHTML = `
    <div class="md-summary">${res.sample.videosAnalysed} videos in the sample, ${res.sample.outliersInSample} outliers
      · ok ${s.ok} / fix ${s.warn} / unreliable ${s.unreliable}</div>
    ${sigHtml}${dupHtml}`;
}

async function mdReview() {
  const body = mdReadForm();
  if (!body.title) { $('mdResult').innerHTML = '<div class="md-summary">Enter a title</div>'; return; }
  $('mdResult').innerHTML = '<div class="md-summary">checking…</div>';
  const res = await send({ type: 'metadataReview', payload: body });
  if (!res.ok) { $('mdResult').innerHTML = `<div class="md-sig warn">${escHtml(res.error)}</div>`; return; }
  mdRenderResult(res.data);
}

async function mdSaveDraft() {
  const body = mdReadForm();
  if (!body.title) { $('mdResult').innerHTML = '<div class="md-summary">Enter a title</div>'; return; }
  body.review = mdLastReview;
  const res = await send({ type: 'saveDraft', payload: body });
  if (!res.ok) { $('mdResult').innerHTML = `<div class="md-sig warn">${escHtml(res.error)}</div>`; return; }
  $('mdResult').innerHTML = `<div class="md-summary">Draft saved (id ${res.data.id}) -- it can be linked to a video ID from the dashboard after publishing.</div>`;
}

document.addEventListener('DOMContentLoaded', load);
['baseUrl', 'autoFetch', 'showBadges', 'onlyOutliers', 'showVph', 'apiToken'].forEach((id) =>
  document.getElementById(id).addEventListener('change', save));
document.getElementById('check').addEventListener('click', checkHealth);
document.getElementById('mdReview').addEventListener('click', mdReview);
document.getElementById('mdSave').addEventListener('click', mdSaveDraft);
document.getElementById('alertsScan').addEventListener('click', scanAlertsNow);
document.getElementById('alertsMarkSeen').addEventListener('click', markAlertsSeen);
document.getElementById('alertsDetails').addEventListener('toggle', function onToggle() {
  if (this.open) loadAlerts();
});
