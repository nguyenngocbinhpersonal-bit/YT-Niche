/* Dashboard screen. Routing -- router.js, shared code -- shared.js, components -- ui.js. */
import { $, api, q, esc, toast, sectionHead, empty, notice } from '../ui.js';
import { view } from '../shared.js';

/* --------------------------------------------- Content calendar (plan 33) */

// Time is stored in UTC and shown in the browser's time zone.
const STATE = { planned: ['', 'planned'], overdue: ['chip-bad', 'overdue'],
  published: ['chip-good', 'published'], unplanned: ['', 'no date'] };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let mode = 'week';
let anchor = startOfWeek(new Date());
let selected = null;
let lastPlan = null;

function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function range() {
  if (mode === 'week') {
    const end = new Date(anchor); end.setDate(end.getDate() + 7);
    return [anchor, end];
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const end = new Date(start); end.setDate(end.getDate() + 42);
  return [start, end];
}

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const localInput = (iso) => {
  const d = new Date(iso);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function chip(x) {
  const [cls] = STATE[x.state] || [''];
  const when = x.plannedAt || x.publishedAt;
  return `<div class="chip ${cls} cal-item" draggable="${x.state === 'published' ? 'false' : 'true'}" data-id="${x.id}"
    style="display:block;margin:3px 0;cursor:pointer;white-space:normal;text-align:left"
    title="${esc(x.title || '')}">${when ? `<b>${hhmm(when)}</b> ` : ''}${esc(x.title || `draft ${x.id}`)}</div>`;
}

function grid(d, start, days) {
  const byDay = {};
  for (const x of d.items) {
    const key = dayKey(new Date(x.plannedAt || x.publishedAt));
    (byDay[key] ||= []).push(x);
  }
  const today = dayKey(new Date());
  const cells = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start); day.setDate(day.getDate() + i);
    const key = dayKey(day);
    const other = mode === 'month' && day.getMonth() !== anchor.getMonth();
    cells.push(`<div class="cal-day" data-day="${key}" style="border:1px solid var(--border);border-radius:8px;
      padding:6px;min-height:${mode === 'week' ? 160 : 90}px;${other ? 'opacity:.5;' : ''}${key === today ? 'border-color:var(--series);' : ''}">
      <div class="section-sub" style="margin:0">${DAYS[i % 7]} ${day.getDate()}</div>
      ${(byDay[key] || []).map(chip).join('')}</div>`);
  }
  return `<div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px">${cells.join('')}</div>`;
}

function editor(d) {
  if (!selected) return '';
  const x = [...d.items, ...d.unplanned].find((i) => i.id === selected);
  if (!x) return '';
  const [cls, label] = STATE[x.state] || ['', x.state];
  const plan = lastPlan && lastPlan.id === x.id ? lastPlan : null;
  const slots = plan?.bestSlots?.length
    ? `Best time for the niche (UTC): ${plan.bestSlots.map((s) => `${s.weekday} ${String(s.hour).padStart(2, '0')}:00`).join(', ')}${
      plan.fitsBestSlot === true ? ' — you hit one of them.' : plan.fitsBestSlot === false ? ' — the chosen time is not one of them.' : ''}`
    : '';
  return `<div class="card">${sectionHead(x.title || `Draft ${x.id}`, x.niche ? `niche ${x.niche}` : '',
      `<span class="chip ${cls}">${esc(label)}</span>`)}
    ${x.state === 'published' ? `<div class="section-sub">Published: <a href="https://www.youtube.com/watch?v=${esc(x.videoId)}" target="_blank" rel="noopener">${esc(x.videoId)}</a></div>`
      : `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <label class="field-label">Release date and time (your time zone)<br>
          <input type="datetime-local" id="calWhen" value="${x.plannedAt ? localInput(x.plannedAt) : ''}"></label>
        <button class="btn" id="calSave">Save</button>
        ${x.plannedAt ? '<button class="btn btn-ghost" id="calUnplan">Remove from calendar</button>' : ''}
      </div>
      ${slots ? `<div class="section-sub" style="margin-top:8px">${esc(slots)}</div>` : ''}
      <div class="section-sub" style="margin-top:8px">A reminder arrives in Telegram and the digest a day before and at release time,
        until the draft is linked to a published video (the "link" button on the "Metadata review" screen).</div>`}
  </div>`;
}

async function plan(id, iso) {
  try {
    lastPlan = await api(`/api/drafts/${id}/plan`, { method: 'POST', body: { plannedAt: iso } });
    selected = id;
    toast(iso ? 'Draft added to the calendar' : 'Draft removed from the calendar', 'ok');
    viewCalendar();
  } catch (e) { toast(e.message, 'err'); }
}

async function viewCalendar() {
  const [start, end] = range();
  const days = Math.round((end - start) / 864e5);
  const d = await api('/api/calendar' + q({ start: start.toISOString(), end: end.toISOString() }));
  const title = mode === 'week'
    ? `${start.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })} — ${new Date(end - 864e5).toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`
    : anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  view.innerHTML = `
    <div class="card">
      ${sectionHead('Calendar', 'drafts by release day · drag a draft onto a day', `
        <button class="btn btn-ghost btn-sm" id="calPrev">‹</button>
        <button class="btn btn-ghost btn-sm" id="calToday">Today</button>
        <button class="btn btn-ghost btn-sm" id="calNext">›</button>
        <button class="btn btn-ghost btn-sm" id="calMode">${mode === 'week' ? 'Month' : 'Week'}</button>`)}
      <div class="section-title" style="margin-bottom:8px">${esc(title)}</div>
      ${grid(d, start, days)}
    </div>
    <div class="card">
      ${sectionHead('No date', 'drafts from the brief and metadata review — drag onto a day or click')}
      ${d.unplanned.length ? `<div class="cal-day" data-day="" style="display:flex;flex-wrap:wrap;gap:6px">
        ${d.unplanned.map(chip).join('')}</div>` : empty('all drafts are already on the calendar — new ones come from the brief and "Metadata review"')}
    </div>
    ${editor(d)}
    ${notice('Time is shown in the browser\'s time zone and stored in UTC. The niche\'s best time is a correlation, not a guarantee.')}`;

  const move = (delta) => {
    if (mode === 'week') anchor.setDate(anchor.getDate() + 7 * delta);
    else anchor = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
    viewCalendar();
  };
  $('#calPrev').addEventListener('click', () => move(-1));
  $('#calNext').addEventListener('click', () => move(1));
  $('#calToday').addEventListener('click', () => {
    anchor = mode === 'week' ? startOfWeek(new Date()) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    viewCalendar();
  });
  $('#calMode').addEventListener('click', () => {
    mode = mode === 'week' ? 'month' : 'week';
    anchor = mode === 'week' ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    viewCalendar();
  });

  const all = [...d.items, ...d.unplanned];
  view.querySelectorAll('.cal-item').forEach((el) => {
    el.addEventListener('click', () => { selected = Number(el.dataset.id); viewCalendar(); });
    el.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', el.dataset.id));
  });
  view.querySelectorAll('.cal-day[data-day]').forEach((cell) => {
    if (!cell.dataset.day) return;
    cell.addEventListener('dragover', (e) => e.preventDefault());
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/plain'));
      const x = all.find((i) => i.id === id);
      if (!x) return;
      // keep the time and change only the day; a draft without a date gets 12:00
      const old = x.plannedAt ? new Date(x.plannedAt) : null;
      const [y, m, dd] = cell.dataset.day.split('-').map(Number);
      const when = new Date(y, m - 1, dd, old ? old.getHours() : 12, old ? old.getMinutes() : 0);
      plan(id, when.toISOString());
    });
  });
  $('#calSave')?.addEventListener('click', () => {
    const v = $('#calWhen').value;
    if (!v) { toast('Enter a date and time', 'err'); return; }
    plan(selected, new Date(v).toISOString());
  });
  $('#calUnplan')?.addEventListener('click', () => plan(selected, null));
}

export { viewCalendar };
