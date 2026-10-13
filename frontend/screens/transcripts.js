/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, compact, esc, toast, sectionHead, notice, empty, state } from '../ui.js';
import { view } from '../shared.js';
import { hookResultHtml, HOOK_FEATURE_LABEL } from '../hook_view.js';

/* ------------------------------------------------------- Transcripts (19) */

let transcriptTab = 'pending';
let transcriptSearchQuery = '';
let transcriptSearchResult = null;
let transcriptPasteOpenFor = null;

function transcriptQueueCard(item, tab) {
  const link = `https://www.youtube.com/watch?v=${esc(item.videoId)}`;
  return `
    <div class="row" style="align-items:flex-start;flex-direction:column;gap:8px">
      <div style="display:flex;width:100%;justify-content:space-between;gap:12px">
        <div class="row-main">
          <div class="row-title"><a href="${link}" target="_blank" rel="noopener">${esc(item.title || item.videoId)}</a></div>
          <div class="row-sub">${esc(item.channelTitle || '')}${item.views != null ? ` · ${compact(item.views)} views` : ''}
            ${item.reason ? ` · reason: ${esc(item.reason)}` : ''}${item.compareGroup ? ` · group: ${esc(item.compareGroup)}` : ''}</div>
          ${item.error ? `<div class="row-sub" style="color:var(--critical)">${esc(item.error)}</div>` : ''}
        </div>
        ${tab === 'pending' || tab === 'error'
          ? `<button class="btn btn-ghost btn-sm transcript-paste-btn" data-video-id="${esc(item.videoId)}">
              ${tab === 'error' ? 'Retry' : 'Paste transcript'}</button>`
          : `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
              <button class="btn btn-ghost btn-sm transcript-hook-btn" data-video-id="${esc(item.videoId)}">Hook</button>
              <button class="btn btn-ghost btn-sm transcript-reindex-btn" data-video-id="${esc(item.videoId)}">Reindex</button>
            </div>`}
      </div>
      ${tab === 'ready' ? `
      <div class="transcript-hook-box" data-video-id="${esc(item.videoId)}" hidden style="width:100%">
        <label class="row-sub" style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
          <input type="checkbox" class="transcript-hook-llm">
          LLM analysis (may cost money, sends the text to the provider)
        </label>
        <div class="transcript-hook-result"></div>
      </div>` : ''}
      <div class="transcript-paste-form" data-video-id="${esc(item.videoId)}" ${transcriptPasteOpenFor === item.videoId ? '' : 'hidden'}
        style="width:100%">
        <textarea class="transcript-paste-input" rows="8" placeholder="Paste the transcript text from YouTube (with or without timestamps)"
          style="width:100%;font-family:inherit;resize:vertical"></textarea>
        <div style="display:flex;gap:10px;margin-top:8px;align-items:center">
          <input type="text" class="transcript-lang-input" placeholder="language (optional)" style="width:140px">
          <button class="btn btn-sm transcript-save-btn" data-video-id="${esc(item.videoId)}">Save</button>
          <span class="transcript-save-status row-sub"></span>
        </div>
      </div>
    </div>`;
}

function hookBenchmarkHtml(b) {
  const head = sectionHead('Niche benchmark: hook',
    'the first ~30 seconds of outliers and of ordinary videos — only from pasted transcripts; a score of the text, not the picture');
  if (!b) return `<div class="card">${head}<div class="section-sub">Pick a niche in the filter at the top.</div></div>`;
  if (!b.found) return `<div class="card">${head}<div class="section-sub">Not enough data: 0 of 10 —
    this niche's videos have no saved transcripts.</div></div>`;
  if (!b.reliable) {
    return `<div class="card">${head}<div class="section-sub">Not enough data: outliers ${b.have.outliers} of ${b.need},
      ordinary videos ${b.have.regular} of ${b.need}. The grey zone (${b.greyZone}) and videos without a baseline (${b.withoutOutlierScore}) are not counted.</div></div>`;
  }
  const more = b.moreCommonInOutliers.length
    ? b.moreCommonInOutliers.map((n) => `${esc(HOOK_FEATURE_LABEL[n] || n)} (+${b.features[n].diffPp} pp)`).join(', ')
    : 'no notable difference';
  return `<div class="card">${head}
    <div class="section-sub">Average score: outliers ${b.outliers.meanScore}, ordinary ${b.regular.meanScore}
      (over ${b.outliers.n} and ${b.regular.n} videos). More common in outliers: ${more}. This is a correlation, not causation.</div></div>`;
}

function transcriptSearchResultsHtml(result) {
  if (!result) return '';
  if (result.hint) return notice(esc(result.hint));
  if (!result.results.length) return empty('nothing found');
  return `<div class="rows">${result.results.map((r) => `
    <div class="row" style="align-items:flex-start">
      <div class="row-main">
        <div class="row-title"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title || r.videoId)}</a></div>
        <div class="row-sub">${esc(r.channelTitle || '')}${r.views != null ? ` · ${compact(r.views)} views` : ''}
          ${r.startSec != null ? ` · ${Math.floor(r.startSec / 60)}:${String(r.startSec % 60).padStart(2, '0')}` : ''}</div>
        <div style="margin-top:4px">${esc(r.text || '')}</div>
      </div>
    </div>`).join('')}</div>`;
}

async function viewTranscripts() {
  const [queueRes, searchRes, hookBench] = await Promise.all([
    api('/api/transcripts/queue'),
    transcriptSearchQuery ? api(`/api/transcripts/search${q({ query: transcriptSearchQuery })}`) : null,
    state.niche ? api(`/api/niches/${encodeURIComponent(state.niche)}/hook-benchmark`) : null,
  ]);
  transcriptSearchResult = searchRes;
  const queue = queueRes.queue || [];
  const byTab = {
    pending: queue.filter((i) => i.status === 'pending'),
    ready: queue.filter((i) => i.status === 'ready'),
    error: queue.filter((i) => i.status === 'error'),
  };
  const tabs = [['pending', 'Pending'], ['ready', 'Ready'], ['error', 'Errors']];

  view.innerHTML = `
    <div class="card">
      ${sectionHead('Transcript search', 'hybrid search: vector + full-text')}
      <div style="display:flex;gap:10px">
        <input type="text" id="transcriptSearchInput" placeholder="what are we looking for..." value="${esc(transcriptSearchQuery)}" style="flex:1">
        <button class="btn" id="transcriptSearchBtn">Search</button>
      </div>
      ${transcriptSearchQuery ? `<div style="margin-top:12px">${transcriptSearchResultsHtml(transcriptSearchResult)}</div>` : ''}
    </div>

    ${hookBenchmarkHtml(hookBench)}

    <div class="card">
      ${sectionHead('Transcript queue', 'subtitles are not downloaded automatically — only manually')}
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <input type="text" id="transcriptAddVideoId" placeholder="video ID" style="width:140px">
        <input type="text" id="transcriptAddReason" placeholder="reason (optional)" style="width:200px">
        <button class="btn btn-ghost btn-sm" id="transcriptAddBtn">Request transcript</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        ${tabs.map(([key, label]) => `<button class="btn btn-sm ${transcriptTab === key ? '' : 'btn-ghost'} transcript-tab-btn" data-tab="${key}">
          ${label} (${byTab[key].length})</button>`).join('')}
      </div>
      <div class="rows">${byTab[transcriptTab].length
        ? byTab[transcriptTab].map((item) => transcriptQueueCard(item, transcriptTab)).join('')
        : empty('empty')}</div>
    </div>`;

  $('#transcriptAddBtn').addEventListener('click', async () => {
    const videoId = $('#transcriptAddVideoId').value.trim();
    if (!videoId) { toast('Enter a video ID', 'err'); return; }
    try {
      await api('/api/transcripts/request', { method: 'POST', body: {
        videoId, reason: $('#transcriptAddReason').value.trim() || undefined,
      } });
      toast('Added to the queue', 'ok');
      viewTranscripts();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#transcriptSearchBtn').addEventListener('click', () => {
    transcriptSearchQuery = $('#transcriptSearchInput').value.trim();
    viewTranscripts();
  });
  view.querySelectorAll('.transcript-tab-btn').forEach((b) => b.addEventListener('click', () => {
    transcriptTab = b.dataset.tab;
    viewTranscripts();
  }));
  view.querySelectorAll('.transcript-paste-btn').forEach((b) => b.addEventListener('click', () => {
    transcriptPasteOpenFor = transcriptPasteOpenFor === b.dataset.videoId ? null : b.dataset.videoId;
    viewTranscripts();
  }));
  view.querySelectorAll('.transcript-reindex-btn').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await api(`/api/transcripts/${encodeURIComponent(b.dataset.videoId)}/reindex`, { method: 'POST' });
      toast('Reindexed', 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { b.disabled = false; }
  }));
  view.querySelectorAll('.transcript-hook-btn').forEach((b) => b.addEventListener('click', async () => {
    const box = view.querySelector(`.transcript-hook-box[data-video-id="${CSS.escape(b.dataset.videoId)}"]`);
    const out = box.querySelector('.transcript-hook-result');
    box.hidden = false;
    b.disabled = true;
    out.innerHTML = '<div class="row-sub">calculating…</div>';
    try {
      const llm = box.querySelector('.transcript-hook-llm').checked;
      const r = await api(`/api/videos/${encodeURIComponent(b.dataset.videoId)}/hook${q({
        niche: state.niche || undefined, llm: llm ? 'true' : undefined })}`);
      out.innerHTML = hookResultHtml(r);
    } catch (e) { out.innerHTML = `<div class="row-sub" style="color:var(--critical)">${esc(e.message)}</div>`; }
    finally { b.disabled = false; }
  }));
  view.querySelectorAll('.transcript-save-btn').forEach((b) => b.addEventListener('click', async () => {
    const form = b.closest('.transcript-paste-form');
    const text = form.querySelector('.transcript-paste-input').value;
    const language = form.querySelector('.transcript-lang-input').value.trim() || undefined;
    const status = form.querySelector('.transcript-save-status');
    if (!text.trim()) { status.textContent = 'paste the text'; return; }
    b.disabled = true;
    status.textContent = 'saving…';
    try {
      const r = await api(`/api/transcripts/${encodeURIComponent(b.dataset.videoId)}/save`,
        { method: 'POST', body: { text, language } });
      if (r.status === 'ready') {
        toast(`Saved: ${r.chunks} chunks, ${r.wordCount} words`, 'ok');
        transcriptPasteOpenFor = null;
        viewTranscripts();
      } else {
        status.textContent = r.error || 'error';
      }
    } catch (e) {
      status.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  }));
}

export { viewTranscripts };
