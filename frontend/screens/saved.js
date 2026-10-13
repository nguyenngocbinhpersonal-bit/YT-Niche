/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { api, ago, esc, toast, sectionHead, empty, table } from '../ui.js';
import { view, render } from '../shared.js';

/* --------------------------------------------------------------- Saved */

async function viewSaved() {
  const d = await api('/api/saved');
  const items = d.items || [];
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Saved', 'saved videos and channels with a snapshot of metrics at the time of saving')}
      ${items.length ? table([
        { label: 'Type', render: (r) => r.kind === 'video' ? 'video' : 'channel' },
        { label: '', wrap: true, render: (r) => r.kind === 'video'
            ? `<a href="https://www.youtube.com/watch?v=${esc(r.refId)}" target="_blank" rel="noopener">${esc(r.payload?.video?.title || r.refId)}</a>`
            : `<a href="#/channel/${esc(r.refId)}">${esc(r.payload?.profile?.title || r.refId)}</a>` },
        { label: 'Folder', render: (r) => esc(r.folder || 'default') },
        { label: 'Note', wrap: true, render: (r) => esc(r.note || '') },
        { label: 'Saved', render: (r) => ago(r.createdAt) },
        { label: '', render: (r) => `<button class="btn btn-ghost btn-sm unsave" data-id="${r.id}">remove</button>` },
      ], items) : empty('nothing yet — the "Save" button is in the extension panel on a video or channel page')}
    </div>`;
  view.querySelectorAll('.unsave').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/saved/${b.dataset.id}`, { method: 'DELETE' });
      toast('Removed from saved', 'ok'); render();
    } catch (e) { toast(e.message, 'err'); }
  }));
}

export { viewSaved };
