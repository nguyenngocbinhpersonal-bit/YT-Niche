/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, esc, toast, sectionHead, notice, state } from '../ui.js';
import { view } from '../shared.js';
import { hookResultHtml } from '../hook_view.js';

/* ---------------------------------------------------- Score titles (09) */

let titleScoreResult = null;
let titleSuggestResult = null;
let hookDraftResult = null;   // the draft text itself is never kept, only its score

function titleResultRow(t) {
  const cls = t.score >= 70 ? 'chip-good' : t.score < 40 ? 'chip-bad' : '';
  return `
    <div class="row" style="align-items:flex-start">
      <div class="row-main">
        <div class="row-title">${esc(t.title)} <span class="chip ${cls}">${t.score}</span></div>
        <div class="row-sub">length ${t.signals.length}${t.signals.hasNumber ? ' · has a number' : ''}
          ${t.signals.matchedPatterns.length ? ` · patterns: ${t.signals.matchedPatterns.map(esc).join(', ')}` : ''}
          ${t.signals.isLikelyDuplicate ? ' · looks like an already published video' : ''}</div>
        ${t.strengths?.length ? `<div class="row-sub">+ ${t.strengths.map(esc).join(' · ')}</div>` : ''}
        ${t.risks?.length ? `<div class="row-sub">− ${t.risks.map(esc).join(' · ')}</div>` : ''}
        ${t.improved ? `<div class="row-sub"><b>Improved version:</b> ${esc(t.improved)}</div>` : ''}
      </div>
    </div>`;
}

async function viewTitleScoring() {
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Score titles', 'a score by niche patterns + LLM (if enabled); the niche comes from the global filter')}
      <textarea id="titleCandidatesInput" rows="6" placeholder="one title per line"
        style="width:100%;font-family:inherit;resize:vertical"></textarea>
      <div style="margin-top:10px">
        <button class="btn" id="titleScoreBtn">Score</button>
      </div>
      ${titleScoreResult ? `<div style="margin-top:12px">
        ${titleScoreResult.hint ? notice(esc(titleScoreResult.hint)) : ''}
        <div class="rows">${titleScoreResult.titles.map(titleResultRow).join('')}</div>
      </div>` : ''}
    </div>

    <div class="card">
      ${sectionHead('Generate variants', 'a configured LLM_PROVIDER is required')}
      <div style="display:flex;gap:10px">
        <input type="text" id="titleTopicInput" placeholder="video topic" style="flex:1">
        <button class="btn" id="titleSuggestBtn">Generate</button>
      </div>
      ${titleSuggestResult ? `<div style="margin-top:12px">
        ${titleSuggestResult.hint ? notice(esc(titleSuggestResult.hint)) : ''}
        <div class="rows">${(titleSuggestResult.titles || []).map(titleResultRow).join('')}</div>
      </div>` : ''}
    </div>

    <div class="card">
      ${sectionHead('Check the intro', 'a score of the intro text, not the picture or editing; the text is not stored anywhere')}
      <textarea id="hookDraftInput" rows="5" placeholder="paste the first 20–30 seconds of the script"
        style="width:100%;font-family:inherit;resize:vertical"></textarea>
      <div style="margin-top:10px">
        <button class="btn" id="hookScoreBtn">Score</button>
      </div>
      ${hookDraftResult ? `<div style="margin-top:12px">${hookResultHtml(hookDraftResult)}</div>` : ''}
    </div>`;

  $('#titleScoreBtn').addEventListener('click', async () => {
    const candidates = $('#titleCandidatesInput').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!candidates.length) { toast('Enter at least one title', 'err'); return; }
    if (!state.niche) { toast('Pick a niche in the filter at the top', 'err'); return; }
    try {
      titleScoreResult = await api('/api/titles/score', { method: 'POST',
        body: { candidates, niche: state.niche } });
      viewTitleScoring();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#hookScoreBtn').addEventListener('click', async () => {
    const text = $('#hookDraftInput').value.trim();
    if (!text) { toast('Paste the intro text', 'err'); return; }
    try {
      hookDraftResult = await api('/api/hooks/score', { method: 'POST',
        body: { text, niche: state.niche || undefined } });
      viewTitleScoring();
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#titleSuggestBtn').addEventListener('click', async () => {
    const topic = $('#titleTopicInput').value.trim();
    if (!topic) { toast('Enter a topic', 'err'); return; }
    if (!state.niche) { toast('Pick a niche in the filter at the top', 'err'); return; }
    try {
      titleSuggestResult = await api('/api/titles/suggest', { method: 'POST',
        body: { topic, niche: state.niche, n: 8 } });
      viewTitleScoring();
    } catch (e) { toast(e.message, 'err'); }
  });
}

export { viewTitleScoring };
