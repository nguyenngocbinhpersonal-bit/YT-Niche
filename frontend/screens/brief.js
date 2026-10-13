/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, num, compact, mult, ago, esc, toast, tile, sectionHead, notice, empty, trajectoryChart, compareHref, qmark, outlierTraitsBlock } from '../ui.js';
import { view } from '../shared.js';

/* ------------------------------------------------------- Brief from an outlier */

const VERDICT = {
  free: ['topic is open', 'chip-good'],
  recent: ['filmed recently', 'chip-warn'],
  proven: ['demand proven', 'chip-good'],
  flopped: ['already flopped', 'chip-bad'],
};
const PART = {
  source: 'Source video', hook: 'Hook', why_viral: 'Why it broke out', titles: 'Titles', angle: 'Niche patterns',
  overlap: 'Is the topic taken', thumbnailReferences: 'Thumbnail references',
};

function skippedBlock(list) {
  if (!list.length) return '';
  return `<div class="card">${sectionHead('What could not be collected', 'every missing part is named honestly, no boilerplate is substituted for it')}
    <ul class="digest-list">${list.map((s) =>
      `<li style="white-space:normal"><b>${esc(PART[s.part] || s.part)}</b> — ${esc(s.reason)}</li>`).join('')}</ul></div>`;
}

function briefHtml(b, llm) {
  const s = b.source;
  const ov = b.overlap;
  const v = ov && (VERDICT[ov.verdict] || [ov.verdict, '']);
  return `
    <div class="card">
      ${sectionHead(b.gapTopic ? 'Brief for a gap' : 'Brief from an outlier', 'research, not a script: pick YOUR OWN angle, not a copy')}
      ${b.gapTopic ? `<div class="section-sub">Viewer question: <b>${esc(b.gapTopic)}</b>. The topic check and titles are about it,
        the video below is the source under which it was asked.</div>` : ''}
      <div class="tiles">
        ${tile('Multiplier', mult(s.outlierScore), esc(s.outlierBand || ''))}
        ${tile('Views', compact(s.views))}
        ${tile('Format', s.isShort ? 'Short' : 'long', s.lengthSeconds ? `${num(s.lengthSeconds)} s` : '')}
        ${ov ? tile('Topic', `<span class="chip ${v[1]}">${esc(v[0])}</span>`,
            `${num(ov.matchCount)} similar in the database`) : ''}
      </div>
      <div class="vcard-title" style="margin-top:10px"><a href="https://www.youtube.com/watch?v=${esc(s.videoId)}" target="_blank" rel="noopener">${esc(s.title)}</a></div>
      <div class="vcard-meta"><a href="#/channel/${esc(s.channelId)}">${esc(s.channelTitle || s.channelId)}</a>
        ${b.niche ? ` · niche ${esc(b.niche)}` : ''}${s.publishedAt ? ` · ${ago(s.publishedAt)}` : ''}</div>
    </div>

    <div class="card">
      ${sectionHead('Hook', 'the first ~75 words of the pasted transcript (about 30 seconds)')}
      ${b.hook.available ? `<blockquote class="brief-quote">${esc(b.hook.text)}</blockquote>`
        : `<div class="section-sub">${esc(b.hook.action)}</div>`}
    </div>

    ${b.why ? `<div class="card">${sectionHead('Why it broke out', 'LLM analysis from the channel data')}
      <ul class="digest-list">${(b.why.hooks || []).map((h) => `<li style="white-space:normal">${esc(h)}</li>`).join('')}</ul>
      ${b.why.replicable_formula ? `<div class="section-sub">Formula: ${esc(b.why.replicable_formula)}</div>` : ''}
      ${b.why.timing_factor ? `<div class="section-sub">Timing: ${esc(b.why.timing_factor)}</div>` : ''}</div>` : ''}

    <div class="card">
      ${sectionHead('Titles', b.titles.suggestions.length ? 'LLM candidates with a score' : 'new titles are not generated without an LLM')}
      ${b.titles.suggestions.length ? `<ul class="digest-list">${b.titles.suggestions.map((t) =>
        `<li style="white-space:normal"><b>${esc(t.score)}</b> · ${esc(t.title)}</li>`).join('')}</ul>` : ''}
      ${b.titles.patternSkeletons.length ? `<div class="section-sub">Phrases that occur more often in the niche's outliers:
        ${b.titles.patternSkeletons.map((k) => `<span class="chip">${esc(k)}</span>`).join(' ')}</div>` : ''}
      ${b.angle.matchedInTitle.length ? `<div class="section-sub">This title already has: ${
        b.angle.matchedInTitle.map((k) => `<span class="chip chip-good">${esc(k)}</span>`).join(' ')}</div>` : ''}
      ${b.angle.bestTime.length ? `<div class="section-sub">Best publishing time in the niche: ${
        b.angle.bestTime.map((t) => `${esc(t.weekday)} ${String(t.hour).padStart(2, '0')}:00`).join(', ')} (UTC)</div>` : ''}
    </div>

    ${ov && ov.matches.length ? `<div class="card">${sectionHead(b.gapTopic ? 'Already filmed on this question' : 'Already filmed on this topic', 'excluding the source video itself')}
      <ul class="digest-list">${ov.matches.slice(0, 6).map((m) =>
        `<li style="white-space:normal"><a href="https://www.youtube.com/watch?v=${esc(m.videoId)}" target="_blank" rel="noopener">${esc(m.title)}</a>
          · ${esc(m.channelTitle || '')} · ×${esc(m.outlierScore ?? '—')}</li>`).join('')}</ul></div>` : ''}

    ${b.thumbnailReferences.length ? `<div class="card">${sectionHead('Thumbnail references', 'similar videos from your database')}
      <div class="cards">${b.thumbnailReferences.map((r) => `<article class="vcard">
        <a class="thumb" href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">
          ${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb-fallback">no thumbnail</div>'}</a>
        <div class="vcard-title">${esc(r.title)}</div>
        <div class="vcard-meta">${compact(r.views)} views · similarity ${Math.round((r.similarity || 0) * 100)}%</div>
      </article>`).join('')}</div></div>` : ''}

    <div id="briefTraj"></div>
    <div id="briefRepeat"></div>
    <div id="briefTraits"></div>
    <div id="briefThumbs"></div>

    ${skippedBlock(b.skipped)}

    <div class="card" id="briefActions">
      ${b.draftId ? `<div class="section-sub">Saved to drafts (#${b.draftId}). Next — <a href="#/metadata">metadata review</a>
        and <a href="#/titles">title scoring</a>.</div>`
        : `<button class="btn" id="saveBrief" type="button">Save to drafts</button>
           ${llm ? '' : '<button class="btn btn-ghost" id="withLlm" type="button">Add LLM analysis (may cost money)</button>'}
           <div class="section-sub" style="margin-top:8px">Saving creates a draft linking to this video and queues
             the missing transcript. No YouTube quota is spent.</div>`}
    </div>`;
}

/* Similar by picture (plan 13): who else has a thumbnail that looks the same, other channels.
   Without thumbnail vectors the block is simply not shown. */
async function fillSimilarThumbs(videoId) {
  const box = $('#briefThumbs');
  if (!box) return;
  try {
    const d = await api(`/api/videos/${encodeURIComponent(videoId)}/similar-thumbnails?limit=6&exclude_same_channel=true`);
    if (!d.similar || !d.similar.length) return;
    box.innerHTML = `<div class="card">${sectionHead('Similar by picture', 'whose thumbnails look the same — whether this look is worth repeating')}
      <div class="cards">${d.similar.map((r) => `<article class="vcard">
        <a class="thumb" href="https://www.youtube.com/watch?v=${esc(r.videoId)}" target="_blank" rel="noopener">
          ${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy">` : '<div class="thumb-fallback">no thumbnail</div>'}</a>
        <div class="vcard-title">${esc(r.title)}</div>
        <div class="vcard-meta">${esc(r.channelTitle || '')} · similarity ${Math.round(r.similarity * 100)}%</div>
      </article>`).join('')}</div>
      <div class="section-sub">CLIP compares the style and content of the picture, not the text.</div></div>`;
  } catch { /* not critical: the brief is complete without this block */ }
}

/* "Is the format repeated?" (plan 21): did such a video work for other channels, or is it
   one channel's one-off luck. An estimate from the collected database, not YouTube data. */
const REPEAT_TEXT = {
  repeatable: ['chip-good', 'format is repeated'],
  mixed: ['', 'worked for some'],
  one_off: ['chip-bad', 'looks like one-off luck'],
  unknown: ['', 'not enough data'],
};

async function fillRepeatability(videoId) {
  const box = $('#briefRepeat');
  if (!box) return;
  try {
    const d = await api(`/api/videos/${encodeURIComponent(videoId)}/repeatability`);
    const [cls, label] = REPEAT_TEXT[d.verdict] || ['', d.verdict];
    const why = d.reason === 'no-embedding' ? 'the video has no embedding yet — the worker will compute it within an hour'
      : d.verdict === 'unknown' ? `few similar videos from other channels are collected (${num(d.similarVideos)})`
      : `outlier ≥ ×${d.hitScore} at ${num(d.channelsHit)} of ${num(d.channels)} channels with similar videos; median of the channel's best video ×${d.medianChannelBest}`;
    box.innerHTML = `<div class="card">${sectionHead('Is the format repeated?', 'videos of other channels similar in meaning — who else it worked for', qmark('repeatability'))}
      <div><span class="chip ${cls}">${esc(label)}</span> ${esc(why)}</div>
      ${d.examples?.length ? `<ul class="digest-list">${d.examples.slice(0, 6).map((m) =>
        `<li style="white-space:normal"><a href="https://www.youtube.com/watch?v=${esc(m.videoId)}" target="_blank" rel="noopener">${esc(m.title)}</a>
          · ${esc(m.channelTitle || '')} · ×${esc(m.outlierScore)} · similarity ${Math.round((m.similarity || 0) * 100)}%</li>`).join('')}</ul>` : ''}
      ${d.titleOpening?.opening ? `<div class="section-sub">${num(d.titleOpening.otherChannels)} more channels start titles the same way (“${esc(d.titleOpening.opening)}…”).</div>` : ''}
      <div class="section-sub">An estimate from the collected database: "one-off luck" may mean that channels that repeated the format are simply not collected.</div></div>`;
  } catch { /* not critical: the brief is complete without this block */ }
}

/* "What breakouts have in common" (plan 29): traits of the niche's outliers of the same format
   as the source video. Without a niche the block is not shown. */
async function fillOutlierTraits(b) {
  const box = $('#briefTraits');
  if (!box || !b.niche) return;
  try {
    const d = await api(`/api/niches/${encodeURIComponent(b.niche)}/outlier-traits`);
    box.innerHTML = outlierTraitsBlock(d, b.source?.isShort ? 'short' : 'long');
  } catch { /* not critical: the brief is complete without this block */ }
}

/* Trajectory of the source video (plan 20): how it gained views compared
   with an ordinary video of its channel. Without snapshots the block is not shown. */
async function fillTrajectory(videoId) {
  const box = $('#briefTraj');
  if (!box) return;
  try {
    const d = await api(`/api/videos/trajectory?ids=${encodeURIComponent(videoId)}`);
    const v = d.videos[0];
    if (!v || v.points.length < 2) return;
    box.innerHTML = `<div class="card">${sectionHead('How it gained views', 'from worker snapshots; dashed line — an ordinary video of this channel',
        `${qmark('expectedCurve')} <a class="btn btn-ghost btn-sm" href="${compareHref(videoId)}">Compare with others</a>`)}
      ${trajectoryChart(d.videos)}</div>`;
  } catch { /* not critical: the brief is complete without this block */ }
}

async function viewBrief(videoId, gapTopic = null) {
  let useLlm = false;
  const load = async (save) => api('/api/briefs', { method: 'POST', body: { videoId, save, useLlm, gapTopic } });
  const draw = (b) => {
    view.innerHTML = briefHtml(b, useLlm);
    fillSimilarThumbs(videoId);
    fillRepeatability(videoId);
    fillOutlierTraits(b);
    fillTrajectory(videoId);
    const saveBtn = $('#saveBrief');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try { draw(await load(true)); toast('Brief saved to drafts', 'ok'); }
      catch (e) { saveBtn.disabled = false; toast(e.message, 'err'); }
    });
    const llmBtn = $('#withLlm');
    if (llmBtn) llmBtn.addEventListener('click', async () => {
      llmBtn.disabled = true; llmBtn.textContent = 'Calculating…';
      useLlm = true;
      try { draw(await load(false)); }
      catch (e) { useLlm = false; llmBtn.disabled = false; llmBtn.textContent = 'Add LLM analysis (may cost money)'; toast(e.message, 'err'); }
    });
  };
  try {
    draw(await load(false));
  } catch (e) {
    view.innerHTML = notice(`<div><b>The brief could not be built.</b><br>${esc(e.message)}</div>`, 'error')
      + empty('the video is not in the database — collect the channel and open the brief again');
  }
}

export { viewBrief };
