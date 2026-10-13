/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, ago, esc, toast, sectionHead, empty } from '../ui.js';
import { view, render } from '../shared.js';

/* ------------------------------------------------------------- Alerts */

/* The same events that go to Telegram/webhook; visible only for tracked channels. */
const KINDS = {
  outlier: ['Outlier', (p) => `×${p.outlierScore} · ${compact(p.views)} views`],
  acceleration: ['Acceleration', (p) => `×${p.acceleration} · ${num(p.vph24h)} VPH over 24 h`],
  title_change: ['Title change', (p) => `“${p.oldTitle || ''}” → “${p.newTitle || ''}”`],
  silence_break: ['Back after a pause', (p) => `silent for ${p.gapDays} d`],
  channel_gone: ['Channel gone', (p) => `had ${compact(p.subscribers)} subs · ${compact(p.views)} views · ${num(p.videoCount)} videos`],
  video_gone: ['Video gone', (p) => `was outlier ×${p.outlierScore} · ${compact(p.views)} views`],
  milestone: ['Milestone', (p) => `${num(p.milestone)} subscribers · now ${num(p.subscribers)}`],
  topic_match: ['Topic', (p) => `“${p.topic}” · similarity ${p.similarity}${p.channelTitle ? ` · ${p.channelTitle}` : ''}`],
};
const GONE = new Set(['channel_gone', 'video_gone']);

function eventRow(e) {
  const p = e.payload || {};
  const [label, line] = KINDS[e.kind] || [e.kind, () => ''];
  const title = p.videoId
    ? `<a href="https://www.youtube.com/watch?v=${esc(p.videoId)}" target="_blank" rel="noopener">${esc(p.title || p.videoId)}</a>`
    : esc(p.title || e.refId);
  const channel = p.channelId ? ` · <a href="#/channel/${esc(p.channelId)}">channel</a>` : '';
  return `<div class="row">
    <div class="row-main">
      <div class="row-title">${e.seenAt ? '' : '<span class="chip chip-accent">new</span> '}
        <span class="chip ${GONE.has(e.kind) ? 'chip-bad' : ''}">${esc(label)}</span> ${title}</div>
      <div class="row-sub">${esc(line(p))}${channel} · ${ago(e.createdAt)}</div>
    </div>
  </div>`;
}

/* Plan 19: your own topics. A new video close to a topic by embedding gives a personal
   "Topic" alert — only to the topic's author. No quota is spent. */
function topicsCard(t) {
  const row = (x) => `<div class="row">
    <div class="row-main">
      <div class="row-title">${x.paused ? '<span class="chip">paused</span> ' : ''}${esc(x.text)}</div>
      <div class="row-sub">similarity threshold ${x.threshold} · since ${new Date(x.createdAt).toLocaleDateString('en-US')}${
        x.searchYoutube ? ` · searched on YouTube${x.lastSearchedAt ? `, last time ${new Date(x.lastSearchedAt).toLocaleString('en-US')}` : ''}` : ''}</div>
    </div>
    <button class="btn btn-ghost btn-sm" data-search="${x.id}" data-on="${x.searchYoutube ? 1 : 0}" type="button"
      data-tip="Once a day, search for new videos on the topic across all of YouTube: one search of the 100 per day for the whole installation, no more than 5 topics per day">${
        x.searchYoutube ? 'Stop searching YouTube' : 'Search YouTube'}</button>
    <button class="btn btn-ghost btn-sm" data-pause="${x.id}" data-paused="${x.paused ? 1 : 0}" type="button">${x.paused ? 'Resume' : 'Pause'}</button>
    <button class="btn btn-ghost btn-sm" data-del="${x.id}" type="button">Remove</button>
  </div>`;
  return `<div class="card">
    ${sectionHead('My topics', 'an alert when a video on your topic enters the database — from the tracker RSS, collected niches and trends; with the "On YouTube" box checked — also from a daily search')}
    <div class="form-row">
      <label class="field" style="flex:1"><span class="field-label">Topic in your own words</span>
        <input id="tpText" placeholder="e.g. AI agents for small business" maxlength="300"></label>
      <label class="field"><span class="field-label">Threshold</span>
        <input id="tpThr" type="number" min="0.3" max="0.95" step="0.05" value="0.6" style="width:90px"></label>
      <label class="field" data-tip="Once a day, search for new videos on the topic across all of YouTube — one search of the 100 per day">
        <span class="field-label">On YouTube</span><input type="checkbox" id="tpSearch"></label>
      <button class="btn" id="tpAdd" type="button">Follow</button>
    </div>
    ${t.topics.length ? `<div class="rows" style="margin-top:10px">${t.topics.map(row).join('')}</div>`
                      : '<div class="section-sub" style="margin-top:10px">no topics yet</div>'}
  </div>`;
}

function wireTopics() {
  $('#tpAdd')?.addEventListener('click', async () => {
    try {
      await api('/api/topics', { method: 'POST', body: {
        text: $('#tpText').value, threshold: Number($('#tpThr').value), searchYoutube: $('#tpSearch').checked } });
      toast('Topic added — matches will appear here', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); }
  });
  document.querySelectorAll('[data-pause]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/topics/${b.dataset.pause}/pause`, { method: 'POST', body: { paused: b.dataset.paused !== '1' } });
    render();
  }));
  document.querySelectorAll('[data-search]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/topics/${b.dataset.search}/search`, { method: 'POST', body: { on: b.dataset.on !== '1' } });
    render();
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/api/topics/${b.dataset.del}`, { method: 'DELETE' });
    render();
  }));
}

async function viewAlerts() {
  const p = { kind: '', unseen_only: false };
  try { Object.assign(p, JSON.parse(localStorage.getItem('nf.alerts') || '{}')); } catch (e) { /* empty */ }
  const [d, topics] = await Promise.all([
    api(`/api/events${q({ kind: p.kind, unseen_only: p.unseen_only || '', limit: 200 })}`),
    api('/api/topics')]);
  const opt = (v, l) => `<option value="${esc(v)}"${p.kind === v ? ' selected' : ''}>${esc(l)}</option>`;

  view.innerHTML = `
    <div class="card">
      ${sectionHead('Alerts', 'events for tracked channels and for your topics — the same as what goes to Telegram or a webhook',
        '<button class="btn btn-ghost btn-sm" id="alSeen" type="button">Mark all as read</button>')}
      <div class="form-row">
        <label class="field"><span class="field-label">Type</span>
          <select id="alKind">${opt('', 'all')}${Object.entries(KINDS).map(([k, [l]]) => opt(k, l)).join('')}</select></label>
        <label class="field"><span class="field-label">New only</span>
          <input type="checkbox" id="alUnseen"${p.unseen_only ? ' checked' : ''}></label>
        <button class="btn" id="alApply" type="button">Apply</button>
      </div>
      <div class="section-sub" style="margin-top:10px">Shown: <b>${num(d.events.length)}</b> · new in total:
        <b>${num(d.unseenCount)}</b> · no quota is spent. "Gone" is set after two API misses
        at least 6 hours apart: the channel is deleted, hidden or blocked.</div>
    </div>
    <div class="card">
      ${d.events.length ? `<div class="rows">${d.events.map(eventRow).join('')}</div>`
                        : empty('no events — add channels to the tracker or a topic below, the worker checks them on a schedule')}
    </div>
    ${topicsCard(topics)}`;
  wireTopics();

  $('#alApply').addEventListener('click', () => {
    localStorage.setItem('nf.alerts', JSON.stringify({
      kind: $('#alKind').value, unseen_only: $('#alUnseen').checked,
    }));
    render();
  });
  $('#alSeen').addEventListener('click', async () => {
    await api('/api/events/seen', { method: 'POST', body: { all: true } });
    toast('All alerts marked as read');
    render();
  });
}

export { viewAlerts };
