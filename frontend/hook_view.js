/* Shared view of the intro score result (plan 10) -- for the transcripts and titles screens. */
import { esc } from './ui.js';

const LEVEL = {
  strong: ['strong', 'chip-good'],
  ok: ['average', ''],
  weak: ['weak', 'chip-bad'],
  'insufficient-data': ['too little text', ''],
};

const FEATURE_LABEL = {
  question: 'a question to the viewer',
  number: 'a number or an amount',
  promise: 'a promised result',
  intrigue: 'intrigue or conflict',
  secondPerson: 'addressing the viewer as "you"',
  firstSentence: 'a short first sentence',
  pace: 'speech pace',
};

function featureRow(name, f) {
  const label = FEATURE_LABEL[name] || name;
  if (!f) return `<li style="white-space:normal"><span class="row-sub">${esc(label)}: not scored</span></li>`;
  const evidence = f.evidence && f.evidence.length ? ` <span class="row-sub">(${f.evidence.map(esc).join(', ')})</span>` : '';
  return `<li style="white-space:normal">${f.hit ? '✓ present' : '✗ absent'} — ${esc(label)}: ${f.points} of ${f.max}${evidence}</li>`;
}

function comparisonHtml(cmp) {
  if (!cmp) return '';
  if (cmp.benchmarkLevel === 'insufficient-data') {
    return `<div class="row-sub">Comparison with the niche: not enough data (10 outliers and 10 ordinary videos with transcripts are needed).</div>`;
  }
  const gaps = cmp.featureGaps.length
    ? ` Outliers more often have what you lack: ${cmp.featureGaps.map((n) => esc(FEATURE_LABEL[n] || n)).join(', ')}.` : '';
  return `<div class="row-sub">Comparison with the niche: your score ${cmp.yourScore}, outliers average ${cmp.outlierMean},
    ordinary videos ${cmp.regularMean}.${gaps}</div>`;
}

function llmHtml(result) {
  if (result.llm) {
    const l = result.llm;
    const list = (items) => `<ul class="digest-list">${(items || []).map((x) => `<li style="white-space:normal">${esc(x)}</li>`).join('')}</ul>`;
    return `<div style="margin-top:10px"><b>LLM analysis</b>${l.cached ? ' <span class="row-sub">(from cache)</span>' : ''}
      ${l.works?.length ? `<div class="row-sub">What works</div>${list(l.works)}` : ''}
      ${l.improve?.length ? `<div class="row-sub">What to improve</div>${list(l.improve)}` : ''}
      ${l.rewrite ? `<div class="row-sub"><b>Suggested intro:</b> ${esc(l.rewrite)}</div>` : ''}</div>`;
  }
  return result.llmHint ? `<div class="row-sub" style="margin-top:10px">${esc(result.llmHint)}</div>` : '';
}

/* result -- the response of GET /api/videos/{id}/hook or POST /api/hooks/score */
function hookResultHtml(result) {
  if (!result) return '';
  if (result.hasTranscript === false) return `<div class="row-sub">${esc(result.hint || 'no transcript')}</div>`;
  const [levelLabel, levelCls] = LEVEL[result.level] || [result.level, ''];
  if (result.score == null) return `<div class="row-sub">Too little text to score.</div>`;
  const features = Object.entries(result.features || {}).map(([n, f]) => featureRow(n, f)).join('');
  const penalties = (result.penalties || []).map((p) =>
    `<li style="white-space:normal">${p.points} — ${p.id === 'greeting' ? 'a greeting at the start of the text'
      : `filler phrases: ${esc(p.text.split(': ')[1] || '')}`}</li>`).join('');
  const tips = (result.tips || []).map((t) => `<li style="white-space:normal">${esc(t.text)}</li>`).join('');
  return `
    <div class="hook-result">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="chip ${levelCls}" style="font-size:14px">${result.score} / 100 · ${esc(levelLabel)}</span>
        ${result.hook ? `<span class="row-sub">${result.hook.words} words${result.hook.mode === 'timed' ? ', with timestamps' : ', without timestamps'}</span>` : ''}
      </div>
      ${result.hook?.warning ? `<div class="row-sub" style="color:var(--critical);margin-top:6px">${esc(result.hook.warning)}</div>` : ''}
      ${!result.punctuated ? '<div class="row-sub" style="margin-top:6px">The text has almost no punctuation — questions by "?" and the length of the first sentence are not scored.</div>' : ''}
      <ul class="digest-list" style="margin-top:8px">${features}</ul>
      ${penalties ? `<div class="row-sub">Filler at the start</div><ul class="digest-list">${penalties}</ul>` : ''}
      ${tips ? `<div class="row-sub">What you could try</div><ul class="digest-list">${tips}</ul>` : ''}
      ${comparisonHtml(result.comparison || result.nicheComparison)}
      ${llmHtml(result)}
      <div class="row-sub" style="margin-top:8px">A score of the intro text, not of the visual hook; correlation, not causation.</div>
    </div>`;
}

export { hookResultHtml, FEATURE_LABEL as HOOK_FEATURE_LABEL };
