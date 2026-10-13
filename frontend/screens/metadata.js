/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, mult, ago, esc, toast, tile, sectionHead, notice, empty, table, state } from '../ui.js';
import { view, plabel } from '../shared.js';

/* ------------------------------------------------------- Metadata review */

const MD_VERDICT_LABEL = { ok: 'ok', warn: 'worth fixing', unreliable: 'sample too small' };

function metadataSignalRow(s) {
  const cls = s.verdict === 'ok' ? 'chip-good' : s.verdict === 'warn' ? 'chip-bad' : '';
  return `<div class="row" style="align-items:flex-start">
    <div class="row-main">
      <div class="row-title"><span class="chip ${cls}">${esc(MD_VERDICT_LABEL[s.verdict] || s.verdict)}</span> ${esc(s.id || '')}</div>
      <div class="row-sub">${esc(s.explanation || '')}</div>
    </div>
  </div>`;
}

let mdLastReview = null;

async function viewMetadata() {
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Metadata review', 'a check of a title/description/tags draft against your own database -- no single "SEO score", only signals with their own sample')}
      <div class="form-row">
        <label class="field" style="flex:2 1 320px"><span class="field-label">Title</span>
          <input type="text" id="mdTitle" placeholder="5 neural network secrets nobody talks about"></label>
        <label class="field"><span class="field-label">Niche</span>
          <input type="text" id="mdNiche" value="${esc(state.niche || '')}" placeholder="ai-explainers"></label>
        <label class="field"><span class="field-label">Channel ID (optional)</span>
          <input type="text" id="mdChannel" placeholder="UC..."></label>
      </div>
      <div class="form-row" style="margin-top:12px">
        <label class="field" style="flex:2 1 320px"><span class="field-label">Description</span>
          <textarea id="mdDesc" rows="3" placeholder="00:00 intro..."></textarea></label>
        <label class="field"><span class="field-label">Tags (comma-separated)</span>
          <input type="text" id="mdTags" placeholder="neural networks, ai"></label>
        <label class="field" style="flex:0 0 auto">
          <span class="field-label">Shorts</span>
          <input type="checkbox" id="mdShort" style="width:auto;height:38px"></label>
      </div>
      <div class="form-row" style="margin-top:12px">
        <button class="btn" id="mdReviewBtn" type="button">Check</button>
        <button class="btn btn-ghost" id="mdSaveBtn" type="button">Save as draft</button>
      </div>
    </div>
    <div id="mdResult"></div>
    <div class="card" id="mdDraftsCard">
      ${sectionHead('Saved drafts', 'link to a video ID after publishing -- useful for checking whether the prediction came true')}
      <div id="mdDraftsBody">${empty('loading…')}</div>
    </div>`;

  function renderMdResult(res) {
    mdLastReview = res;
    const box = $('#mdResult');
    if (res.hint) {
      box.innerHTML = `<div class="card">${notice(esc(res.hint), 'warn')}</div>`;
      return;
    }
    box.innerHTML = `
      <div class="card">
        ${sectionHead('Summary', `${res.sample.videosAnalysed} videos in the sample, ${res.sample.outliersInSample} of them outliers · ${plabel(res.sample.period)}`)}
        <div class="tiles">
          ${tile('OK', num(res.summary.ok))}
          ${tile('Worth fixing', num(res.summary.warn))}
          ${tile('Unreliable', num(res.summary.unreliable))}
        </div>
      </div>
      <div class="grid-2">
        <div class="card">
          ${sectionHead('Signals')}
          ${res.signals.length ? res.signals.map(metadataSignalRow).join('') : empty('no signals')}
        </div>
        <div class="card">
          ${sectionHead('Structural niche patterns', res.keyPhrase ? `key phrase: “${esc(res.keyPhrase)}”` : 'no stable key phrase')}
          ${res.structuralPatterns.length ? table([
            { label: 'Feature', render: (r) => esc(r.label) },
            { label: 'Lift', num: true, render: (r) => r.lift != null ? mult(r.lift) : '—' },
            { label: 'Sample', num: true, render: (r) => num(r.sample) },
            { label: 'In the draft', render: (r) => r.presentInDraft ? 'yes' : 'no' },
            { label: '', render: (r) => r.verdict === 'unreliable' ? '<span class="chip">sample too small</span>' : '' },
          ], res.structuralPatterns) : empty('no data')}
        </div>
      </div>
      <div class="card">
        ${sectionHead('Similar topics in the database', 'cosine of the draft embedding against your own database -- is the topic already crowded?')}
        ${res.nearDuplicates.hint ? notice(esc(res.nearDuplicates.hint), '')
          : res.nearDuplicates.near.length ? table([
              { label: 'Video', wrap: true, render: (r) => `<a href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">${esc(r.title || r.videoId)}</a>` },
              { label: 'Views', num: true, render: (r) => compact(r.views) },
              { label: 'Similarity', num: true, render: (r) => r.similarity },
            ], res.nearDuplicates.near)
          : empty(`checked ${res.nearDuplicates.checked} videos -- no close topics found`)}
      </div>`;
  }

  async function loadMdDrafts() {
    const chId = $('#mdChannel')?.value.trim() || null;
    const d = await api(`/api/drafts${q({ channel_id: chId })}`);
    $('#mdDraftsBody').innerHTML = d.drafts.length ? table([
      { label: 'Title', wrap: true, render: (r) => esc(r.title) },
      { label: 'Niche', render: (r) => esc(r.niche || '—') },
      { label: 'Saved', render: (r) => ago(r.createdAt) },
      { label: 'Video', render: (r) => r.videoId
          ? `<a href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">${esc(r.videoId)}</a>`
          : `<div class="form-row"><input type="text" class="mdLinkVid" data-id="${r.id}" placeholder="video ID" style="width:140px">
             <button class="btn btn-ghost btn-sm mdDoLink" data-id="${r.id}" type="button">link</button></div>` },
    ], d.drafts) : empty('nothing yet -- press "Save as draft" above');
    $('#mdDraftsBody').querySelectorAll('.mdDoLink').forEach((b) => b.addEventListener('click', async () => {
      const input = $(`.mdLinkVid[data-id="${b.dataset.id}"]`);
      const vid = input.value.trim();
      if (!vid) return toast('Enter a video ID', 'err');
      try {
        await api(`/api/drafts/${b.dataset.id}/link`, { method: 'POST', body: { videoId: vid } });
        toast('Linked', 'ok'); loadMdDrafts();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  function mdReadForm() {
    return {
      title: $('#mdTitle').value.trim(),
      description: $('#mdDesc').value,
      tags: $('#mdTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      niche: $('#mdNiche').value.trim() || null,
      channelId: $('#mdChannel').value.trim() || null,
      isShort: $('#mdShort').checked,
    };
  }

  $('#mdReviewBtn').addEventListener('click', async () => {
    const body = mdReadForm();
    if (!body.title) return toast('Enter a title', 'err');
    try {
      renderMdResult(await api('/api/metadata/review', { method: 'POST', body }));
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#mdSaveBtn').addEventListener('click', async () => {
    const body = mdReadForm();
    if (!body.title) return toast('Enter a title', 'err');
    body.review = mdLastReview;
    try {
      await api('/api/drafts', { method: 'POST', body });
      toast('Draft saved', 'ok');
      await loadMdDrafts();
    } catch (e) { toast(e.message, 'err'); }
  });

  await loadMdDrafts();
}

export { viewMetadata };
