/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, num, compact, ago, esc, sectionHead, empty, state } from '../ui.js';
import { view, plabel, base, render } from '../shared.js';

/* ------------------------------------------------------------ Repackaging */

const FIELD_LABEL = { title: 'title', thumbnail_image: 'thumbnail' };

function effectChip(e) {
  if (!e || !e.enoughData) {
    return '<span class="chip" data-tip="Two stat snapshots are needed, before and after the change, within 48 hours">effect: not enough data</span>';
  }
  const r = e.ratio;
  const cls = r == null ? '' : r > 1.2 ? 'chip-good' : r < 0.8 ? 'chip-bad' : '';
  const arrow = r == null ? '' : r > 1.2 ? '▲ ' : r < 0.8 ? '▼ ' : '= ';
  const tip = 'Views per hour for 48 h before and after the change. This is an observation, not a cause: views also fall on their own as a video ages';
  return `<span class="chip ${cls}" data-tip="${tip}">${arrow}${num(e.vphBefore)} → ${num(e.vphAfter)} VPH${r != null ? ` (×${r})` : ''}</span>`;
}

function img(src, label) {
  return `<figure class="pk-shot">
    ${src ? `<img src="${esc(src)}" alt="${esc(label)}" loading="lazy">`
          : '<div class="thumb-fallback">not in the archive</div>'}
    <figcaption>${esc(label)}</figcaption></figure>`;
}

function changeCard(c) {
  const body = c.field === 'thumbnail_image'
    ? `<div class="pk-pair">${img(c.beforeImage, 'before')}${img(c.afterImage, 'after')}</div>`
    : `<div class="pk-titles"><div class="pk-old">${esc(c.old)}</div>
         <div class="pk-arrow">↓</div><div class="pk-new">${esc(c.new)}</div></div>`;
  return `<article class="card pk-card">
    <div class="vcard-chips">
      <span class="chip chip-accent">${esc(FIELD_LABEL[c.field] || c.field)}</span>
      ${effectChip(c.effect)}
    </div>
    ${body}
    <div class="vcard-title"><a href="https://www.youtube.com/watch?v=${esc(c.videoId)}" target="_blank" rel="noopener">${esc(c.title || c.videoId)}</a></div>
    <div class="vcard-meta"><a href="#/channel/${esc(c.channelId)}">${esc(c.channelTitle || c.channelId)}</a>
      · ${compact(c.views)} views · changed ${ago(c.changedAt)}</div>
  </article>`;
}

async function viewPackaging() {
  const p = { field: '', channel_id: '' };
  try { Object.assign(p, JSON.parse(localStorage.getItem('nf.packaging') || '{}')); } catch (e) { /* empty */ }
  const [d, tracked] = await Promise.all([
    api(`/api/packaging${q({ period: base().period, field: p.field, channel_id: p.channel_id, limit: 60 })}`),
    api('/api/channels/tracked').catch(() => ({ channels: [] })),
  ]);
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;

  view.innerHTML = `
    <div class="card">
      ${sectionHead('Repackaging', `title and thumbnail changes after publication — "before / after" and what happened to views · ${plabel(state.period)}`)}
      <div class="form-row">
        <label class="field"><span class="field-label">What was changed</span>
          <select id="pkField">${opt('', 'everything', p.field)}${opt('title', 'titles', p.field)}${opt('thumbnail_image', 'thumbnails', p.field)}</select></label>
        <label class="field"><span class="field-label">Channel</span>
          <select id="pkChannel">${opt('', 'all channels', p.channel_id)}${(tracked.channels || [])
            .map((c) => opt(c.channel_id, c.title || c.channel_id, p.channel_id)).join('')}</select></label>
        <button class="btn" id="pkApply" type="button">Apply</button>
      </div>
      <div class="section-sub" style="margin-top:10px">Found: <b>${num(d.count)}</b> · no quota spent ·
        thumbnails are captured only for tracked channels, the history starts from the first snapshot</div>
    </div>
    ${d.changes.length ? `<div class="cards pk-cards">${d.changes.map(changeCard).join('')}</div>`
                       : empty('no changes found for this period — add channels to the tracker and the worker will start capturing thumbnails')}`;

  $('#pkApply').addEventListener('click', () => {
    localStorage.setItem('nf.packaging', JSON.stringify({
      field: $('#pkField').value, channel_id: $('#pkChannel').value,
    }));
    render();
  });
}

export { viewPackaging };
