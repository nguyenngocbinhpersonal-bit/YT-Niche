/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, ago, esc, toast, sectionHead, empty, table, aiLabelsBadge } from '../ui.js';
import { view, collectForm, wireCollect, render } from '../shared.js';

/* ----------------------------------------------------------------- Tracker */

/* faceless/format/topic (stage 03) live only in the tab's memory -- the filter
   by AI labels is not important enough to survive a reload, unlike
   state.period/niche. */
let channelFilters = { faceless: '', format: '', topic: '' };

async function viewTracker() {
  const f = channelFilters;
  const d = await api(`/api/channels/tracked${q({
    faceless: f.faceless || undefined, content_format: f.format || undefined, topic: f.topic || undefined,
  })}`);
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Channel tracker', 'the worker captures stats for these channels and accumulates history', `
        <select id="filterFaceless">
          <option value="" ${f.faceless === '' ? 'selected' : ''}>faceless: any</option>
          <option value="true" ${f.faceless === 'true' ? 'selected' : ''}>faceless: yes</option>
          <option value="false" ${f.faceless === 'false' ? 'selected' : ''}>faceless: no</option>
        </select>
        <input type="text" id="filterFormat" placeholder="format" value="${esc(f.format)}" style="width:120px">
        <input type="text" id="filterTopic" placeholder="topic" value="${esc(f.topic)}" style="width:120px">`)}
      ${d.channels.length ? table([
        { label: 'Channel', render: (r) => `<a href="#/channel/${esc(r.channel_id)}">${esc(r.title || r.channel_id)}</a>` },
        { label: 'AI', render: (r) => aiLabelsBadge(r.aiLabels) || '—' },
        { label: 'Subscribers', num: true, render: (r) => compact(r.subscriber_count) },
        { label: 'Videos', num: true, render: (r) => num(r.video_count) },
        { label: 'Views', num: true, render: (r) => compact(r.view_count) },
        { label: 'Snapshots', num: true, render: (r) => num(r.snapshots) },
        { label: 'Updated', render: (r) => ago(r.last_refreshed_at) },
        { label: '', render: (r) => `<button class="btn btn-ghost btn-sm untrack" data-id="${esc(r.channel_id)}">remove</button>` },
      ], d.channels) : empty('nobody yet — add a channel below, or the AI-label filter found nothing')}
    </div>
    ${collectForm()}`;
  wireCollect(render);
  const applyFilters = () => {
    channelFilters = {
      faceless: $('#filterFaceless').value,
      format: $('#filterFormat').value.trim(),
      topic: $('#filterTopic').value.trim(),
    };
    render();
  };
  $('#filterFaceless').addEventListener('change', applyFilters);
  $('#filterFormat').addEventListener('change', applyFilters);
  $('#filterTopic').addEventListener('change', applyFilters);
  view.querySelectorAll('.untrack').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/channels/tracked/${b.dataset.id}`, { method: 'DELETE' });
      toast('Removed from the tracker', 'ok'); render();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

export { viewTracker };
