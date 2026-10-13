/* Dashboard entry point: theme, global filters, footer, first render().
   Screens -- screens/*.js, routing -- router.js, shared code -- shared.js. */
import { $, api, esc, notice, state, loadScores } from './ui.js';
import { loadFootStat } from './shared.js';
import { render } from './router.js';

/* --------------------------------------------------------------- startup */

async function loadNiches() {
  try {
    const d = await api('/api/niches');
    const sel = $('#globalNiche');
    sel.innerHTML = '<option value="">all niches</option>' +
      (d.niches || []).map((n) => `<option value="${esc(n.slug)}">${esc(n.slug)} (${n.video_count})</option>`).join('');
    sel.value = state.niche;
  } catch { /* the frontend works without the niche list */ }
}

function initChrome() {
  const per = $('#globalPeriod');
  per.value = state.period;
  per.addEventListener('change', () => {
    state.period = per.value; localStorage.setItem('nf.period', state.period); render();
  });
  $('#globalNiche').addEventListener('change', (e) => {
    state.niche = e.target.value; localStorage.setItem('nf.niche', state.niche); render();
  });
  $('#reloadBtn').addEventListener('click', () => { loadFootStat(); loadNiches(); render(); });

  const themeBtn = $('#themeToggle');
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('nf.theme', t);
    themeBtn.textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
  };
  applyTheme(localStorage.getItem('nf.theme') || 'dark');
  themeBtn.addEventListener('click', () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

  addEventListener('hashchange', render);
}

/* ------------------------------------------------ sign-in (plan 15)
   Only with NF_MULTI_USER=1 on the server. Accounts are created by the admin
   (cli.py create-user); there is no sign-up. The session is an HttpOnly cookie; the script
   neither sees nor stores it. */
function showSignIn(message = '') {
  $('#crumbSection').textContent = 'Sign in';
  $('#view').innerHTML = `${message ? notice(esc(message), 'error') : ''}
    <div class="card" style="max-width:420px">
      <div class="section-head"><div><div class="section-title">Sign in to niche-finder</div>
        <div class="section-sub">accounts are issued by this server's administrator</div></div></div>
      <form id="signInForm" style="display:grid;gap:10px">
        <input type="email" id="signInEmail" placeholder="email" autocomplete="username" required>
        <input type="password" id="signInPassword" placeholder="password" autocomplete="current-password" required>
        <button class="btn" type="submit">Sign in</button>
      </form>
    </div>`;
  $('#signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/auth/login', { method: 'POST',
        body: { email: $('#signInEmail').value, password: $('#signInPassword').value } });
      location.reload();
    } catch (err) { showSignIn(err.message); }
  });
}

async function start() {
  initChrome();
  let me = { multiUser: false, user: null };
  try { me = await api('/api/auth/me'); } catch { /* old server without sign-in */ }
  if (me.multiUser && !me.user) { showSignIn(); return; }
  if (me.multiUser) {
    const out = $('#signOut');
    out.hidden = false;
    out.textContent = `Sign out (${me.user.email})`;
    out.addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      location.reload();
    });
    // Plan 15 (5.5): the user's own share of today's shared YouTube quota.
    const qd = me.quota;
    if (qd) {
      const part = (used, limit) => (limit ? `${used}/${limit}` : `${used}, no limit`);
      const box = $('#myQuota');
      box.hidden = false;
      box.textContent = `Your quota today: ${part(qd.units, qd.limits.units)} units, `
        + `searches ${part(qd.searchCalls, qd.limits.searchCalls)}`;
    }
  }
  addEventListener('nf:signin-required', () => showSignIn('Session expired — please sign in again.'));
  loadNiches();
  loadFootStat();
  // plan 23: the score catalog loads before the first screen -- the "?" hints take their formulas from it
  await loadScores();
  render();
}

start();
