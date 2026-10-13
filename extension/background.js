/* Service worker: the only place that talks to the network.
 *
 * Why not from the content script: the YouTube page is served over https, while the backend
 * listens on http://127.0.0.1 — from the page context that is mixed content.
 * The service worker has its own origin (chrome-extension://), and with host_permissions
 * a request to the local machine goes through without CORS gymnastics.
 *
 * The cache lives here too: YouTube is a SPA, and the panel is redrawn several times for
 * one video. Without a cache these would be extra database requests on every redraw.
 */

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8080',
  autoFetch: true,      // fetch from the YouTube API what is missing in the database (1-2 units)
  showBadges: true,     // badges on video cards in the results
  onlyOutliers: false,  // show a badge only when score >= 1.5
  showVph: true,        // a second badge — views/hour under the thumbnail
  timeoutMs: 12000,
};

const TTL = { video: 120e3, channel: 300e3, deep: 300e3, batch: 600e3, health: 30e3, comments: 1800e3,
             stats: 60e3, why: 1800e3 };

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  // Plan 15 (5.7): a personal API token for a server with sign-in (NF_MULTI_USER=1).
  // The secret goes in storage.local: sync would spread it across all the account's browsers.
  const { apiToken = '' } = await chrome.storage.local.get({ apiToken: '' });
  return { ...DEFAULTS, ...stored, apiToken };
}

// ------------------------------------------------------------------- cache

const cache = new Map();

function cacheGet(key, ttl) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  if (hit) cache.delete(key);
  return null;
}

function cacheSet(key, v) {
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 600) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 200);
    for (const [k] of oldest) cache.delete(k);
  }
}

function cacheDropVideo(id) { cache.delete('video:' + id); cache.delete('card:' + id); }

// ------------------------------------------------------------------- network

async function api(path, { method = 'GET', body = null } = {}) {
  const s = await getSettings();
  const base = (s.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(base + path, {
      method,
      // X-NF-Client on every request: the backend accepts POST/DELETE only with it
      // or with a JSON body, otherwise 403 (protection from other sites, api.py local_only_guard)
      headers: {
        'X-NF-Client': 'extension',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(s.apiToken ? { Authorization: `Bearer ${s.apiToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(s.timeoutMs),
    });
  } catch (e) {
    const err = new Error(`backend is not responding (${base}). Is it running? make dev`);
    err.offline = true;
    throw err;
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { detail: text.slice(0, 300) }; }
  if (!res.ok) {
    const err = new Error(data.detail || data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// --------------------------------------------------------------- scenarios

async function inspectVideo(videoId, refresh) {
  const key = 'video:' + videoId;
  if (!refresh) {
    const hit = cacheGet(key, TTL.video);
    if (hit) return hit;
  }
  const s = await getSettings();
  const q = new URLSearchParams({ video_id: videoId, fetch: String(s.autoFetch) });
  if (refresh) q.set('refresh', 'true');
  const data = await api('/api/inspect/video?' + q);
  cacheSet(key, data);
  return data;
}

async function inspectChannel(ref, refresh) {
  const key = 'channel:' + ref;
  if (!refresh) {
    const hit = cacheGet(key, TTL.channel);
    if (hit) return hit;
  }
  const s = await getSettings();
  const q = new URLSearchParams({ ref, fetch: String(s.autoFetch) });
  if (refresh) q.set('refresh', 'true');
  const data = await api('/api/inspect/channel?' + q);
  cacheSet(key, data);
  return data;
}

/* Deep channel analytics — only if its videos are already in the database.
 * Four requests in parallel, each reads the local Postgres and costs
 * no quota. The failure of any one of them must not take down the whole panel. */
async function channelDeep(channelId) {
  const key = 'deep:' + channelId;
  const hit = cacheGet(key, TTL.deep);
  if (hit) return hit;
  const tzOffset = -new Date().getTimezoneOffset() / 60;
  const soft = (p) => api(p).catch(() => null);
  const [analytics, similar, bestTime, patterns] = await Promise.all([
    soft(`/api/channels/${channelId}?period=30d`),
    soft(`/api/channels/${channelId}/similar?limit=6`),
    soft(`/api/best-time?channel_id=${channelId}&period=180d&timezone_offset_hours=${tzOffset}`),
    soft(`/api/title-patterns?channel_id=${channelId}&period=180d&top_n=8`),
  ]);
  const data = { analytics, similar, bestTime, patterns };
  cacheSet(key, data);
  return data;
}

async function similarVideos(videoId) {
  const key = 'similar:' + videoId;
  const hit = cacheGet(key, TTL.deep);
  if (hit) return hit;
  const data = await api(`/api/videos/${videoId}/similar?limit=6`).catch(() => null);
  if (data) cacheSet(key, data);
  return data;
}

async function packagingHistory(videoId) {
  /* Title/thumbnail swaps of this video (plan 05) -- zero quota, reads what
     the worker already fingerprinted; null when the backend is unreachable. */
  const key = 'packaging:' + videoId;
  const hit = cacheGet(key, TTL.deep);
  if (hit) return hit;
  const data = await api(`/api/videos/${videoId}/packaging`).catch(() => null);
  if (data) cacheSet(key, data);
  return data;
}

async function templateRisk(channelId) {
  /* Plan 01: how templated the channel's recent uploads look. Zero quota, a
     read over the local database; null when the backend is unreachable. */
  const key = 'trisk:' + channelId;
  const hit = cacheGet(key, TTL.deep);
  if (hit) return hit;
  const data = await api(`/api/channels/${channelId}/template-risk`).catch(() => null);
  if (data) cacheSet(key, data);
  return data;
}

async function videoComments(videoId, maxResults = 50) {
  /* POST because it spends 1 unit of quota (commentThreads.list) -- unlike
     everything else the panel shows automatically, this only runs when the
     person clicks "Show comments", and is cached afterwards so
     re-opening the panel within TTL.comments is free. */
  const key = 'comments:' + videoId;
  const hit = cacheGet(key, TTL.comments);
  if (hit) return hit;
  const data = await api(`/api/videos/${videoId}/comments`, {
    method: 'POST', body: { max_results: maxResults },
  });
  cacheSet(key, data);
  return data;
}

async function stats() {
  const hit = cacheGet('stats', TTL.stats);
  if (hit) return hit;
  const data = await api('/api/stats');
  cacheSet('stats', data);
  return data;
}

async function explainOutlier(videoId, refresh) {
  /* Stage 05 -- zero YouTube quota, but a real LLM call on a cache miss (the
     server also caches for LLM_WHY_VIRAL_TTL_DAYS; this is just the
     extension's own short-lived copy so re-opening the panel is free). The
     server returns 204 with no body when LLM_PROVIDER=none -- api() below
     resolves that to null, same as a cache miss looks to the caller. */
  const key = 'why:' + videoId;
  if (!refresh) {
    const hit = cacheGet(key, TTL.why);
    if (hit !== undefined) return hit;
  }
  const data = await api(`/api/video/${videoId}/why${refresh ? '?force_refresh=true' : ''}`);
  cacheSet(key, data);
  return data;
}

async function inspectBatch(ids) {
  const results = {};
  const need = [];
  for (const id of ids) {
    const hit = cacheGet('card:' + id, TTL.batch);
    if (hit) results[id] = hit; else need.push(id);
  }
  if (need.length) {
    const s = await getSettings();
    const data = await api('/api/inspect/videos', {
      method: 'POST',
      body: { ids: need, fetch: s.autoFetch },
    });
    for (const [id, val] of Object.entries(data.results || {})) {
      cacheSet('card:' + id, val);
      results[id] = val;
    }
  }
  return { results };
}

async function health() {
  const hit = cacheGet('health', TTL.health);
  if (hit) return hit;
  const data = await api('/api/health');
  cacheSet('health', data);
  return data;
}

/* Alerts (8.9) -- not cached: the icon counter and the popup must see
   the fresh state, not what it was at the last poll. */
async function listEvents(unseenOnly) {
  const q = unseenOnly ? '?unseen_only=true' : '';
  return api('/api/events' + q);
}

async function markEventsSeen(ids, all) {
  return api('/api/events/seen', { method: 'POST', body: { ids, all } });
}

/* Metadata review (8.8) -- typed in the popup, not cached: every
   call must read the current state of the database, not yesterday's answer. */
async function reviewMetadata(payload) {
  return api('/api/metadata/review', { method: 'POST', body: payload });
}

async function saveDraft(payload) {
  return api('/api/drafts', { method: 'POST', body: payload });
}

// ------------------------------------------------------- icon badge

async function refreshActionBadge() {
  try {
    await api('/api/health');
    const events = await listEvents(true).catch(() => null);
    const n = events && events.unseenCount ? events.unseenCount : 0;
    if (n > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#065fd4' });
      await chrome.action.setBadgeText({ text: n > 99 ? '99+' : String(n) });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    await chrome.action.setBadgeBackgroundColor({ color: '#c62828' });
    await chrome.action.setBadgeText({ text: '!' });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  refreshActionBadge();
  chrome.alarms.create('health', { periodInMinutes: 5 });
  chrome.alarms.create('events', { periodInMinutes: 10 });
});
chrome.runtime.onStartup.addListener(refreshActionBadge);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'health' || a.name === 'events') refreshActionBadge();
});

// ------------------------------------------------------------- routing

const HANDLERS = {
  'settings:get': async () => {
    const s = await getSettings();
    return { ...s, apiToken: s.apiToken ? '••••' : '' };   // the popup only needs "present / absent"
  },
  'settings:set': async (m) => {
    const { apiToken, ...rest } = m.patch || {};
    await chrome.storage.sync.set(rest);
    if (apiToken !== undefined) await chrome.storage.local.set({ apiToken: String(apiToken).trim() });
    cache.clear();
    const s = await getSettings();
    return { ...s, apiToken: s.apiToken ? '••••' : '' };   // the token itself is not returned to the popup
  },
  'health': () => health(),
  'stats': () => stats(),
  'why': (m) => explainOutlier(m.videoId, m.refresh),
  // plan 21: did the format work for other channels (from the collected database, quota 0)
  'repeatability': (m) => api(`/api/videos/${encodeURIComponent(m.videoId)}/repeatability`),
  // plan 30: the channel's net profit per month for the first cost profile
  'profit': (m) => api(`/api/profit?channel_id=${encodeURIComponent(m.channelId)}`),
  // plan 26: is there a similar video in another language (from the collected database, quota 0)
  'languageGap': (m) => api(`/api/videos/${encodeURIComponent(m.videoId)}/language-gap`),
  // plan 20: views by age from worker snapshots, for the mini chart
  'trajectory': (m) => api(`/api/videos/trajectory?ids=${encodeURIComponent(m.videoId)}`),
  'video': (m) => inspectVideo(m.videoId, m.refresh),
  'channel': (m) => inspectChannel(m.ref, m.refresh),
  'deep': (m) => channelDeep(m.channelId),
  'similarVideos': (m) => similarVideos(m.videoId),
  'packaging': (m) => packagingHistory(m.videoId),
  'templateRisk': (m) => templateRisk(m.channelId),
  // plan 22: signals for the three monetization-policy categories (quota 0)
  'policySignals': (m) => api(`/api/channels/${encodeURIComponent(m.channelId)}/policy-signals`),
  'comments': (m) => videoComments(m.videoId, m.maxResults),
  'batch': (m) => inspectBatch(m.ids || []),
  'collect': async (m) => {
    const res = await api('/api/collect/channel', {
      method: 'POST',
      body: { channel: m.channel, max_videos: m.maxVideos || 100, track: !!m.track },
    });
    cache.clear();
    return res;
  },
  'track': async (m) => {
    const res = await api('/api/channels/track', { method: 'POST', body: { channel_id: m.channelId } });
    cache.delete('channel:' + m.channelId);
    return res;
  },
  'untrack': async (m) => {
    const res = await api(`/api/channels/tracked/${m.channelId}`, { method: 'DELETE' });
    cache.delete('channel:' + m.channelId);
    return res;
  },
  'save': (m) => api('/api/saved', { method: 'POST', body: {
    kind: m.kind, refId: m.refId, payload: m.payload, note: m.note, folder: m.folder,
  } }),
  'metadataReview': (m) => reviewMetadata(m.payload),
  'saveDraft': (m) => saveDraft(m.payload),
  // plan 19: follow a topic -- an alert when a similar video enters the database
  'watchTopic': (m) => api('/api/topics', { method: 'POST', body: { text: m.text } }),
  'events': (m) => listEvents(m.unseenOnly),
  'eventsSeen': (m) => markEventsSeen(m.ids, m.all),
  'eventsScan': () => api('/api/events/scan', { method: 'POST' }).then((r) => { refreshActionBadge(); return r; }),
  'cache:drop': (m) => { if (m.videoId) cacheDropVideo(m.videoId); else cache.clear(); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg && msg.type];
  if (!handler) { sendResponse({ ok: false, error: 'unknown command' }); return false; }
  Promise.resolve(handler(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e), offline: !!e.offline, status: e.status }));
  return true; // the response will arrive asynchronously
});
