import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
export const sources = [
 { id: 'bbcnoun', name: 'BBCNOUN', url: 'https://bbcnoun.com.ng/', endpoints: ['https://bbcnoun.com.ng/feed/'] },
 { id: 'nounupdate', name: 'NOUN Update', url: 'https://nounupdate.com/', endpoints: ['https://nounupdate.com/news/'] },
 { id: 'puredu', name: 'Puredu', url: 'https://puredu.net/', endpoints: ['https://puredu.net/'] }
];
export function clean(value = '') { return cheerio.load(String(value)).text().replace(/\s+/g, ' ').trim(); }
export function category(title) {
 if (/timetable|exam|past question|tma/i.test(title)) return 'Examinations';
 if (/admission|programme|program|certificate/i.test(title)) return 'Admissions';
 if (/calendar|registration|fee/i.test(title)) return 'Academics';
 if (/graduat|convocation/i.test(title)) return 'Graduation';
 return 'Campus news';
}
export function item(source, title, link, excerpt = '', date = null) {
 let url; try { url = new URL(link, source.url); } catch { return null; }
 if (url.origin !== new URL(source.url).origin || !['https:', 'http:'].includes(url.protocol)) return null;
 url.hash = ''; title = clean(title);
 if (title.length < 12) return null;
 return { id: createHash('sha256').update(url.href).digest('hex').slice(0, 16), source: source.id, title, url: url.href, excerpt: clean(excerpt).slice(0, 280), publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null, category: category(title) };
}
export function parseFeed(xml, source) {
 const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
 const entries = parsed.rss?.channel?.item || parsed.feed?.entry;
 if (!entries) return [];
 return (Array.isArray(entries) ? entries : [entries]).map(e => item(source, e.title, typeof e.link === 'string' ? e.link : e.link?.['@_href'], e.description || e.summary, e.pubDate || e.published || e.updated)).filter(Boolean);
}
export function parsePage(html, source) {
 const $ = cheerio.load(html); const results = [];
 $('h1 a, h2 a, h3 a, h4 a, article a').each((_, el) => {
 const a = $(el); const href = a.attr('href'); if (!href) return;
 if (source.id === 'puredu' && !href.includes('/post/')) return;
 if (source.id === 'nounupdate' && !/news\/[^/?#]+|news-details|news_detail|view-news|news\.php\?/.test(href)) return;
 const block = a.closest('article').length ? a.closest('article') : a.parent().parent();
 const blockText = block.find('time, li, p, span').map((_, el) => clean($(el).text())).get().join(' ') || clean(block.text());
 const date = block.find('time').attr('datetime') || blockText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/)?.[0];
 const record = item(source, a.text(), href, block.find('p').first().text(), date);
 if (record) {
 const minutes = blockText.match(/\b(\d{1,3})\s+mins?\b/i);
 if (minutes) record.readingMinutes = Math.max(1, Number(minutes[1]));
 results.push(record);
 }
 });
 return [...new Map(results.map(r => [r.id, r])).values()];
}
async function request(url, redirects = 0) {
 const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'manual', headers: { 'User-Agent': 'Nounarchive/1.0 (public headline index; hourly refresh)', Accept: 'application/rss+xml, text/html;q=0.9' } });
 if (response.status >= 300 && response.status < 400) {
 const next = new URL(response.headers.get('location'), url);
 if (redirects >= 3 || next.origin !== new URL(url).origin) throw new Error('Unsupported source redirect');
 return request(next.href, redirects + 1);
 }
 if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
 const reader = response.body.getReader(); let bytes = 0; const chunks = [];
 while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 3_000_000) { await reader.cancel(); throw new Error('Source response too large'); } chunks.push(Buffer.from(value)); }
 return Buffer.concat(chunks).toString('utf8');
}
export async function collect(source) {
 for (const endpoint of source.endpoints) {
 const text = await request(endpoint);
 const entries = endpoint.includes('/feed') ? parseFeed(text, source) : parsePage(text, source);
 if (entries.length) return entries;
 }
 throw new Error('No articles found. Source layout or feed may have changed.');
}
