import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';

export const sources = [
  { id: 'bbcnoun', name: 'BBCNOUN', url: 'https://bbcnoun.com.ng/', endpoints: ['https://bbcnoun.com.ng/feed/'] },
  { id: 'nounupdate', name: 'NOUN Update', url: 'https://nounupdate.com/', endpoints: ['https://nounupdate.com/news/'] },
  { id: 'puredu', name: 'Puredu', url: 'https://puredu.net/', endpoints: ['https://puredu.net/'] }
];

// These pages are read by the server-side daily collector. Their original URLs
// stay in the archive as metadata; the browser only receives Nounarchive routes.
export const resourceSources = sources.filter(source => source.id !== 'puredu').map(({ id, name, url }) => ({ id, name, url, endpoints: [url], allowExternalResources: id === 'bbcnoun' }));

export function clean(value = '') {
  return cheerio.load(String(value)).text().replace(/\s+/g, ' ').trim();
}

export function category(title) {
  if (/timetable|exam|past question|tma/i.test(title)) return 'Examinations';
  if (/admission|programme|program|certificate/i.test(title)) return 'Admissions';
  if (/calendar|registration|fee/i.test(title)) return 'Academics';
  if (/graduat|convocation/i.test(title)) return 'Graduation';
  return 'Campus news';
}

export function item(source, title, link, excerpt = '', date = null) {
  let url;
  try { url = new URL(link, source.url); } catch { return null; }
  if (url.origin !== new URL(source.url).origin || !['https:', 'http:'].includes(url.protocol)) return null;
  url.hash = '';
  title = clean(title);
  if (title.length < 12) return null;
  return {
    id: createHash('sha256').update(url.href).digest('hex').slice(0, 16),
    source: source.id,
    title,
    url: url.href,
    excerpt: clean(excerpt).slice(0, 280),
    publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
    category: category(title)
  };
}

export function parseFeed(xml, source) {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const entries = parsed.rss?.channel?.item || parsed.feed?.entry;
  if (!entries) return [];
  return (Array.isArray(entries) ? entries : [entries]).map(e => item(
    source,
    e.title,
    typeof e.link === 'string' ? e.link : e.link?.['@_href'],
    e.description || e.summary,
    e.pubDate || e.published || e.updated
  )).filter(Boolean);
}

export function parsePage(html, source) {
  const $ = cheerio.load(html);
  const results = [];
  $('h1 a, h2 a, h3 a, h4 a, article a').each((_, el) => {
    const a = $(el);
    const href = a.attr('href');
    if (!href) return;
    // Ignore image-only links and generic calls to action, even inside <article>.
    const title = clean(a.text());
    if (title.length < 12 || /^(read (?:more|story|update|full story)|continue reading|view (?:story|update|details))(?:[\s.!→↗…]|$)/i.test(title)) return;
    if (source.id === 'puredu' && !href.includes('/post/')) return;
    if (source.id === 'nounupdate' && !/news\/[^/?#]+|news-details|news_detail|view-news|news\.php\?/.test(href)) return;
    const block = a.closest('article').length ? a.closest('article') : a.parent().parent();
    const blockText = block.find('time, li, p, span').map((_, el) => clean($(el).text())).get().join(' ') || clean(block.text());
    const date = block.find('time').attr('datetime') || blockText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/)?.[0];
    const record = item(source, title, href, block.find('p').first().text(), date);
    if (record) {
      const minutes = blockText.match(/\b(\d{1,3})\s+mins?\b/i);
      if (minutes) record.readingMinutes = Math.max(1, Number(minutes[1]));
      results.push(record);
    }
  });
  const unique = new Map();
  for (const record of results) {
    const previous = unique.get(record.id);
    unique.set(record.id, previous ? {
      ...previous,
      publishedAt: previous.publishedAt || record.publishedAt,
      excerpt: previous.excerpt || record.excerpt,
      readingMinutes: previous.readingMinutes || record.readingMinutes
    } : record);
  }
  return [...unique.values()];
}

export async function fetchSource(url, redirects = 0, fetcher = fetch) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(12000),
    redirect: 'manual',
    headers: {
      'User-Agent': 'Nounarchive/1.0 (daily news and resource index)',
      Accept: 'application/rss+xml, text/html;q=0.9'
    }
  });
  if (response.status >= 300 && response.status < 400) {
    const next = new URL(response.headers.get('location'), url);
    if (redirects >= 3 || next.origin !== new URL(url).origin) throw new Error('Unsupported source redirect');
    return fetchSource(next.href, redirects + 1, fetcher);
  }
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) return await response.text();
  let bytes = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 3_000_000) {
      await reader.cancel();
      throw new Error('Source response too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function collect(source, fetcher = fetch) {
  const failures = [];
  for (const endpoint of source.endpoints) {
    try {
      const text = await fetchSource(endpoint, 0, fetcher);
      const entries = endpoint.includes('/feed') ? parseFeed(text, source) : parsePage(text, source);
      if (entries.length) return entries;
      failures.push('No articles found. Source layout or feed may have changed.');
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(failures.join('; ') || 'No source endpoints configured.');
}

const resourceTerms = /result|cgpa|grade|graduat|convocation|fee|timetable|calendar|course|summary|past question|tma|exam|study planner|study hub|eligib|admission|programme|program|study cent|scholarship|career|internship|project|seminar|business plan|plagiarism|turnitin|dashboard|resource cent|student guide|glossary|faq|file resiz|faculty|faculties|support|learning tool|download|practice|tutor|coach|success hub/i;
const resourceCategory = title => {
  if (/result|cgpa|grade|graduat|convocation|fee|calendar/i.test(title)) return 'Academics & results';
  if (/admission|eligib|programme|program|study cent|facult|faculty/i.test(title)) return 'Admissions';
  if (/project|seminar|business|career|internship/i.test(title)) return 'Projects & career';
  if (/glossary|faq|file resiz|search/i.test(title)) return 'Reference & utilities';
  if (/news|archive|report/i.test(title)) return 'News & announcements';
  if (/scholarship|resource cent|guide|dashboard|success hub|support|study hub/i.test(title)) return 'Student support';
  return 'Study & examinations';
};
const resourceTool = title => {
  if (/result|cgpa|grade|graduat|convocation|analytics/i.test(title)) return 'grades';
  if (/fee|budget/i.test(title)) return 'budget';
  if (/timetable|calendar/i.test(title)) return 'timetable';
  if (/course material|courseware|library/i.test(title)) return 'library';
  if (/summary|student guide|tutor/i.test(title)) return 'notes';
  if (/past question|tma|exam|quiz|coach|practice/i.test(title)) return 'practice';
  if (/admission|eligib|programme|program|study cent|faculty|faculties/i.test(title)) return 'admissions';
  if (/scholarship|career|internship|opportunit/i.test(title)) return 'opportunities';
  if (/project|seminar|business plan|topic/i.test(title)) return 'project';
  if (/plagiarism|turnitin|similarity/i.test(title)) return 'similarity';
  if (/file resiz/i.test(title)) return 'file-resizer';
  if (/glossary/i.test(title)) return 'glossary';
  if (/faq/i.test(title)) return 'faq';
  if (/news|announc|report|archive/i.test(title)) return 'news';
  if (/dashboard|resource cent|study hub|success hub/i.test(title)) return 'dashboard';
  if (/course|material|guide|tutor|summary|support|study/i.test(title)) return 'notes';
  return 'notebook';
};
const localDescription = tool => ({
  grades: 'Use the local grade and progress workspace with values you enter.',
  budget: 'Estimate and organise costs using amounts you enter.',
  timetable: 'Build a personal timetable or calendar and check for conflicts.',
  practice: 'Create and review your own study questions in a local practice set.',
  admissions: 'Organise application questions and a personal verification checklist.',
  opportunities: 'Track deadlines, contacts, and follow-up tasks in your own list.',
  project: 'Generate and organise a project outline from your own inputs.',
  similarity: 'Compare text passages locally for a rough word-overlap estimate.',
  'file-resizer': 'Resize an image locally in your browser and save the result.',
  glossary: 'Search a compact local study glossary.',
  faq: 'Browse practical answers about Nounarchive tools.',
  news: 'Search locally indexed headlines and short summaries.',
  dashboard: 'Collect plans, notes, and personal study actions in one workspace.',
  notes: 'Write and save study notes in this browser.',
  notebook: 'Create a personal checklist and notes for this resource.'
})[tool] || 'Open a local student workspace.';

function resourceId(source, url) {
  return `${source.id}-${createHash('sha256').update(url).digest('hex').slice(0, 14)}`;
}

export function parseResourcePage(html, source) {
  const $ = cheerio.load(html);
  const found = new Map();
  $('a[href]').each((_, el) => {
    const a = $(el);
    const title = clean(a.text() || a.attr('aria-label') || a.attr('title') || '');
    const href = a.attr('href');
    if (!href || title.length < 3 || title.length > 100 || !resourceTerms.test(title)) return;
    if (/^(read|view|browse|open|learn|more|home|back|contact|sign in|login|register|download)(?:\b|$)/i.test(title)) return;
    let url;
    try { url = new URL(href, source.url); } catch { return; }
    const sameOrigin = url.origin === new URL(source.url).origin;
    if (url.protocol !== 'https:' || (!sameOrigin && !source.allowExternalResources) || url.username || url.password) return;
    if (source.id === 'puredu' && /\/(?:post|posts|news|category|tag)\//i.test(url.pathname)) return;
    if (source.id === 'nounupdate' && /\/(?:news|post)\//i.test(url.pathname)) return;
    if (sameOrigin && (url.pathname === '/' || url.pathname === '')) return;
    url.hash = '';
    if (url.search && !/\.php$/i.test(url.pathname)) url.search = '';
    const key = url.href.replace(/\/$/, '').toLowerCase();
    if (found.has(key)) return;
    const tool = resourceTool(title);
    found.set(key, {
      id: resourceId(source, url.href),
      title,
      category: resourceCategory(title),
      url: url.href,
      source: source.name,
      localTool: tool,
      description: localDescription(tool)
    });
  });
  return [...found.values()];
}

export async function collectResources(source, fetcher = fetch) {
  const failures = [];
  for (const endpoint of source.endpoints) {
    try {
      const text = await fetchSource(endpoint, 0, fetcher);
      const entries = parseResourcePage(text, source);
      if (entries.length) return entries;
      failures.push('No resource tools found. The source page may have changed.');
    } catch (error) {
      failures.push(error.message);
    }
  }
  throw new Error(failures.join('; ') || 'No resource endpoints configured.');
}
