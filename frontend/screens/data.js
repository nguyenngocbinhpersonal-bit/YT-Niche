/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, esc, toast, tile, sectionHead, notice, state } from '../ui.js';
import { view, plabel, collectForm, wireCollect, render } from '../shared.js';

/* ----------------------------------------------------------------- Data */

async function viewData() {
  const [h, cov, fresh] = await Promise.all([
    api('/api/health'), api(`/api/coverage${q({ period: state.period })}`),
    api('/api/freshness').catch(() => null)]);
  view.innerHTML = `
    ${h.hasApiKey ? notice('The YouTube API key is set — collecting is available.', 'ok')
                  : notice('The YouTube API key is not set. Put <code>YOUTUBE_API_KEY</code> in <code>.env</code> and restart <code>docker compose up -d web</code>.', 'error')}
    ${h.historyAvailable ? '' : notice('There is no stats history — VPH over 24 hours, acceleration and channel growth stay empty until the worker has run. Start <code>docker compose up -d worker</code>.')}
    <div class="card">
      ${sectionHead('Database', h.db.db_path)}
      <div class="tiles">
        ${tile('Channels', num(h.db.channels))}
        ${tile('Videos', num(h.db.videos))}
        ${tile('Niches', num(h.db.niches))}
        ${tile('Video snapshots', num(h.db.video_stat_snapshots))}
        ${tile('Channel snapshots', num(h.db.channel_stat_snapshots))}
        ${tile('Title/thumbnail changes', num(h.db.title_thumbnail_changes))}
        ${tile('Videos in window', num(cov.videosPublishedInPeriod), plabel(state.period))}
      </div>
    </div>
    ${freshnessCard(fresh)}
    <div id="costProfiles"></div>
    ${collectForm()}
    <div class="card">
      ${sectionHead('Refresh stats', 'rereads the counters and appends a snapshot — speeds are derived from this')}
      <button class="btn btn-ghost" id="refreshBtn" type="button">Refresh now</button>
    </div>`;
  wireCollect(render);
  loadNotifySettings();
  loadCostProfiles();
  $('#refreshBtn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/refresh', { method: 'POST', body: { period: '30d' } });
      toast(`Refreshed ${r.videos.refreshed} videos and ${r.channels.refreshed} channels`, 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); } finally { e.target.disabled = false; }
  });
}

/* Plan 30: cost profiles -- how much it costs to make one video (voiceover, editing,
   AI generation, stock) and fixed monthly costs. Personal: everyone has their own. */
async function loadCostProfiles() {
  const box = $('#costProfiles');
  if (!box) return;
  let profiles = [];
  try { profiles = (await api('/api/cost-profiles')).profiles; } catch { return; }
  const field = (id, label, value = '') => `<label class="field-label">${label}<br>
    <input type="number" min="0" step="0.01" id="${id}" value="${esc(value)}" style="width:110px"></label>`;
  box.innerHTML = `<div class="card">
    ${sectionHead('Cost profiles', 'for the net-profit calculator on the channel and niche screens, in dollars')}
    ${profiles.length ? `<div class="table-wrap"><table><thead><tr><th>Profile</th><th class="num">Per video</th>
      <th class="num">Per minute</th><th class="num">Per month</th><th></th></tr></thead><tbody>${profiles.map((p) => `<tr>
        <td>${esc(p.name)}</td><td class="num">$${p.per_video_usd}</td><td class="num">$${p.per_minute_usd}</td>
        <td class="num">$${p.monthly_usd}</td>
        <td class="num"><button class="btn btn-ghost btn-sm js-cp-edit" data-id="${p.id}">edit</button>
          <button class="btn btn-ghost btn-sm js-cp-del" data-id="${p.id}">delete</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="section-sub">No profiles yet: profit is computed without costs.</div>'}
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-top:12px">
      <label class="field-label">Name<br><input type="text" id="cpName" placeholder="voiceover + editing" style="width:200px"></label>
      ${field('cpVideo', 'Per video, $')}${field('cpMinute', 'Per video minute, $')}${field('cpMonth', 'Per month, $')}
      <button class="btn" id="cpSave">Save</button>
    </div>
    <div class="section-sub" style="margin-top:6px">Example: voiceover $0.30 per minute, editing $15 per video, subscriptions $40 per month.
      A profile with the same name is overwritten.</div></div>`;
  let editing = null;
  box.querySelectorAll('.js-cp-edit').forEach((b) => b.addEventListener('click', () => {
    const p = profiles.find((x) => String(x.id) === b.dataset.id);
    editing = p.id;
    $('#cpName').value = p.name; $('#cpVideo').value = p.per_video_usd;
    $('#cpMinute').value = p.per_minute_usd; $('#cpMonth').value = p.monthly_usd;
  }));
  box.querySelectorAll('.js-cp-del').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/cost-profiles/${b.dataset.id}`, { method: 'DELETE' }); loadCostProfiles(); }
    catch (e) { toast(e.message, 'err'); }
  }));
  $('#cpSave').addEventListener('click', async () => {
    try {
      await api('/api/cost-profiles', { method: 'POST', body: { id: editing, name: $('#cpName').value,
        perVideoUsd: $('#cpVideo').value, perMinuteUsd: $('#cpMinute').value, monthlyUsd: $('#cpMonth').value } });
      toast('Profile saved', 'ok');
      loadCostProfiles();
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* Plan 16: the YouTube API rule (III.E.4) — data obtained via the key may be stored
   for no longer than 30 days without refresh. Once a day the worker rereads the oldest
   rows; nothing is deleted (the owner's decision) — the history stays at their own risk. */
function freshnessCard(f) {
  if (!f) return '';
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US') : '—');
  return `<div class="card">
      ${sectionHead('Data retention', `YouTube API rule: data obtained via the key may be kept no longer than 30 days without refresh`)}
      <div class="tiles">
        ${tile('Videos not refreshed', num(f.videos.stale), `over ${f.staleDays} d, of ${num(f.videos.total)}`)}
        ${tile('Channels not refreshed', num(f.channels.stale), `over ${f.staleDays} d, of ${num(f.channels.total)}`)}
        ${tile('Snapshot history since', day(f.historySince))}
      </div>
      <div class="section-sub" style="margin-top:10px">Once a day the worker rereads up to
        ${num(f.dailyCap.videos)} videos and ${num(f.dailyCap.channels)} channels from the API, starting with the oldest:
        titles, descriptions and counters. <b>Nothing is deleted</b> — the history of snapshots and repackaging is kept
        indefinitely, which YouTube's rules do not allow without separate approval. For personal use that is your risk;
        before giving other people access, read SECURITY.md and PRIVACY.md.</div>
    </div>`;
}

/* Plan 15 (5.9): your own notifications -- Telegram or a webhook, and a mode. Secrets
   go to the server once and are never shown back. Without saved
   settings a local user falls back to NOTIFY_* from .env. */
async function loadNotifySettings() {
  let st;
  try { st = await api('/api/settings/notifications'); } catch { return; }
  const box = document.createElement('div');
  box.className = 'card';
  box.id = 'notifyCard';
  const src = { env: 'from .env', settings: 'own settings', none: 'not configured' }[st.source] || st.source;
  box.innerHTML = `${sectionHead('Notifications', `now: ${esc(src)} · Telegram ${st.telegram ? 'yes' : 'no'}
      · webhook ${st.webhook ? 'yes' : 'no'} · mode ${esc(st.mode)}`)}
    <div style="display:grid;gap:8px;max-width:520px">
      <input type="password" id="nfBot" placeholder="${st.telegram ? 'bot token saved — enter a new one to replace it' : 'Telegram bot token'}" autocomplete="off">
      <input type="text" id="nfChat" placeholder="chat id" value="${esc(st.telegramChatId || '')}">
      <input type="password" id="nfHook" placeholder="${st.webhook ? 'webhook saved — enter a new one to replace it' : 'or an https webhook address'}" autocomplete="off">
      <select id="nfMode">${['instant', 'digest', 'both', 'off'].map((m) =>
        `<option value="${m}"${m === st.mode ? ' selected' : ''}>${{ instant: 'instant', digest: 'morning digest', both: 'both', off: 'off' }[m]}</option>`).join('')}</select>
      <div><button class="btn btn-sm" id="nfSave" type="button">Save</button>
        <button class="btn btn-ghost btn-sm" id="nfTest" type="button">Test message</button>
        ${st.source === 'settings' ? '<button class="btn btn-ghost btn-sm" id="nfClear" type="button">Reset</button>' : ''}</div>
    </div>
    <div class="section-sub">Alerts come only for your tracked channels. The token and address are stored encrypted
      (<code>OWN_TOKENS_KEY</code> in <code>.env</code> is required); webhook — https to a public address only.</div>`;
  view.appendChild(box);
  const body = () => {
    const b = { telegramChatId: $('#nfChat').value, mode: $('#nfMode').value };
    if ($('#nfBot').value.trim()) b.telegramBotToken = $('#nfBot').value.trim();
    if ($('#nfHook').value.trim()) b.webhookUrl = $('#nfHook').value.trim();
    return b;
  };
  $('#nfSave').addEventListener('click', async () => {
    try { await api('/api/settings/notifications', { method: 'PUT', body: body() }); toast('Saved', 'ok'); box.remove(); loadNotifySettings(); }
    catch (e) { toast(e.message, 'err'); }
  });
  $('#nfTest').addEventListener('click', async () => {
    try { const r = await api('/api/settings/notifications/test', { method: 'POST' }); toast(r.sent ? 'Sent' : 'Not sent', r.sent ? 'ok' : 'err'); }
    catch (e) { toast(e.message, 'err'); }
  });
  const clear = $('#nfClear');
  if (clear) clear.addEventListener('click', async () => {
    try { await api('/api/settings/notifications', { method: 'PUT', body: { clear: true } }); box.remove(); loadNotifySettings(); }
    catch (e) { toast(e.message, 'err'); }
  });
}

export { viewData };
