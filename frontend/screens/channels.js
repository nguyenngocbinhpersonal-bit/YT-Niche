/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, sectionHead, empty, channelRow, state, yppSelect } from '../ui.js';
import { view, plabel, base, render } from '../shared.js';

/* --------------------------------------------------------- Outlier channels */

async function viewChannels() {
  const p = Object.assign(
    { min_multiplier: 1.5, min_subscribers: '', max_subscribers: '', min_ypp_status: '' },
    JSON.parse(localStorage.getItem('nf.channels') || '{}'));
  const d = await api(`/api/outlier-channels${q({
    ...base(), min_multiplier: p.min_multiplier,
    min_subscribers: p.min_subscribers || null, max_subscribers: p.max_subscribers || null,
    min_ypp_status: p.min_ypp_status || null, limit: 50,
  })}`);
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Outlier channels', `${plabel(state.period)} · by database entry date — fresh opportunities`)}
      <div class="form-row">
        <label class="field"><span class="field-label">Multiplier at least</span>
          <input type="number" id="fcMult" value="${p.min_multiplier}" step="0.5"></label>
        <label class="field"><span class="field-label">Subscribers at least</span>
          <input type="number" id="fcMinSubs" value="${p.min_subscribers}" step="1000"></label>
        <label class="field"><span class="field-label">Subscribers at most</span>
          <input type="number" id="fcMaxSubs" value="${p.max_subscribers}" step="1000"></label>
        ${yppSelect('fcYpp', p.min_ypp_status)}
        <button class="btn" id="applyChannels" type="button">Apply</button>
      </div>
      <div class="section-sub" style="margin-top:10px">The multiplier is the best age-normalised outlier among
        the channel's videos in the window, against the median of the same channel's previous uploads.
        Band: &lt;2x, 2–3x, 3–5x, 5–10x, &gt;10x. Sorted by multiplier strength;
        narrow the period window at the top to see only the freshest discoveries.</div>
    </div>
    <div class="card">
      ${d.channels.length ? `<div class="rows">${d.channels.map(channelRow).join('')}</div>`
                          : empty(d.hint || 'no channels above the threshold')}
    </div>`;

  $('#applyChannels').addEventListener('click', () => {
    localStorage.setItem('nf.channels', JSON.stringify({
      min_multiplier: +$('#fcMult').value || 0,
      min_subscribers: $('#fcMinSubs').value ? +$('#fcMinSubs').value : '',
      max_subscribers: $('#fcMaxSubs').value ? +$('#fcMaxSubs').value : '',
      min_ypp_status: $('#fcYpp').value,
    }));
    render();
  });
}

export { viewChannels };
