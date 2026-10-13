/* Hash routing: screen table, menu highlighting, loading with error handling. */
import { $, esc, notice } from './ui.js';
import { view, setRender } from './shared.js';
import { viewOverview } from './screens/overview.js';
import { viewFind } from './screens/find.js';
import { viewViral } from './screens/viral.js';
import { viewCalendar } from './screens/calendar.js';
import { viewChannels } from './screens/channels.js';
import { viewCategories } from './screens/categories.js';
import { viewKeywords } from './screens/keywords.js';
import { viewTopTags } from './screens/tags.js';
import { viewTracker } from './screens/tracker.js';
import { viewAlerts } from './screens/alerts.js';
import { viewEnter } from './screens/enter.js';
import { viewIdeas } from './screens/ideas.js';
import { viewLanguage } from './screens/language.js';
import { viewTranscripts } from './screens/transcripts.js';
import { viewNicheClusters } from './screens/clusters.js';
import { viewTitleScoring } from './screens/titles.js';
import { viewSaved } from './screens/saved.js';
import { viewPackaging } from './screens/packaging.js';
import { viewMetadata } from './screens/metadata.js';
import { viewNiches } from './screens/niches.js';
import { viewNiche } from './screens/niche.js';
import { viewChannel } from './screens/channel.js';
import { viewBrief } from './screens/brief.js';
import { viewCompare } from './screens/compare.js';
import { viewData } from './screens/data.js';
import { viewHelp } from './screens/help.js';
import { viewMcp } from './screens/mcp.js';
import { viewOwn } from './screens/own.js';

async function guard(fn) {
  view.innerHTML = '<div class="skeleton-page"></div>';
  try {
    await fn();
  } catch (e) {
    view.innerHTML = notice(
      `<div><b>Failed to load data.</b><br>${esc(e.message)}<br>
       <span style="color:var(--muted)">Check that the service is running:
       <code>docker compose up -d web</code></span></div>`, 'error');
  }
}

/* --------------------------------------------------------------- routing */

const ROUTES = {
  overview: { title: 'Overview', run: viewOverview },
  find: { title: 'Find a niche', run: viewFind },
  viral: { title: 'Viral videos', run: viewViral },
  channels: { title: 'Outlier channels', run: viewChannels },
  categories: { title: 'Categories', run: viewCategories },
  keywords: { title: 'Keywords', run: viewKeywords },
  tags: { title: 'Top tags by category', run: viewTopTags },
  tracker: { title: 'Channel tracker', run: viewTracker },
  alerts: { title: 'Alerts', run: viewAlerts },
  ideas: { title: 'Idea check', run: viewIdeas },
  language: { title: 'Another language', run: viewLanguage },
  transcripts: { title: 'Transcripts', run: viewTranscripts },
  clusters: { title: 'Niche map', run: viewNicheClusters },
  titles: { title: 'Score titles', run: viewTitleScoring },
  saved: { title: 'Saved', run: viewSaved },
  packaging: { title: 'Repackaging', run: viewPackaging },
  metadata: { title: 'Metadata review', run: viewMetadata },
  calendar: { title: 'Calendar', run: viewCalendar },
  niches: { title: 'Niches', run: viewNiches },
  enter: { title: 'Where to enter', run: viewEnter },
  own: { title: 'My channels', run: viewOwn },
  data: { title: 'Data', run: viewData },
  help: { title: 'Help & FAQ', run: viewHelp },
  mcp: { title: 'MCP connection', run: viewMcp },
};

function setActive(href) {
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', href != null && a.getAttribute('href') === href));
}

async function render() {
  const raw = (location.hash || '#/overview').slice(2);
  // "?…" after the screen holds its parameters (#/brief/<id>?gap=…, #/own?connected=…);
  // the screen name and argument are taken without them.
  const [path, query] = raw.split('?');
  const [name, arg] = path.split('/');
  if (name === 'channel' && arg) {
    $('#crumbSection').textContent = 'Channel'; setActive(null);
    return guard(() => viewChannel(decodeURIComponent(arg)));
  }
  if (name === 'brief' && arg) {
    $('#crumbSection').textContent = 'Brief'; setActive(null);
    // #/brief/<videoId>?gap=<viewer question> -- a brief for a gap (plan 03).
    const gap = new URLSearchParams(query || '').get('gap');
    return guard(() => viewBrief(decodeURIComponent(arg), gap));
  }
  if (name === 'compare') {
    $('#crumbSection').textContent = 'Compare'; setActive(null);
    return guard(() => viewCompare(arg || ''));
  }
  if (name === 'niche' && arg) {
    $('#crumbSection').textContent = 'Niche'; setActive('#/niches');
    return guard(() => viewNiche(decodeURIComponent(arg)));
  }
  const route = ROUTES[name || 'overview'] || ROUTES.overview;
  $('#crumbSection').textContent = route.title;
  setActive(`#/${name || 'overview'}`);
  return guard(route.run);
}

setRender(render);

export { render };
