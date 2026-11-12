import { test } from 'node:test';
import assert from 'node:assert/strict';
import {sources,resourceSources,parseFeed,parsePage,parseResourcePage,item,category} from '../aggregator.js';
test('RSS parsing strips markup and categorizes',()=>{const rows=parseFeed('<rss><channel><item><title>NOUN exam timetable released</title><link>https://bbcnoun.com.ng/exams/</link><description>&lt;p&gt;Exam dates&lt;/p&gt;</description><pubDate>Thu, 02 Apr 2026 19:39:12 +0000</pubDate></item></channel></rss>',sources[0]);assert.equal(rows.length,1);assert.equal(rows[0].excerpt,'Exam dates');assert.equal(rows[0].category,'Examinations');assert.ok(rows[0].publishedAt);});
test('reject offsite and executable URLs',()=>{assert.equal(item(sources[0],'An article title','https://evil.test/'),null);assert.equal(item(sources[0],'An article title','javascript:alert(1)'),null);});
test('HTML adapter deduplicates and skips non-post links',()=>{const rows=parsePage('<h3><a href="/post/noun-update">NOUN student news update</a></h3><h4><a href="/post/noun-update">NOUN student news update</a></h4><h3><a href="/login">Login to your account</a></h3>',sources[2]);assert.equal(rows.length,1);assert.equal(rows[0].publishedAt,null);});
test('feed without articles remains empty',()=>assert.deepEqual(parseFeed('<html>Not a feed</html>',sources[0]),[]));
test('classifies graduation and admission',()=>{assert.equal(category('Graduation list'),'Graduation');assert.equal(category('New certificate programmes'),'Admissions');});
test('HTML listing retains source date and reading time when provided',()=>{const rows=parsePage('<article><h3><a href="/post/noun-report">NOUN student news report</a></h3><ul><li>October 27, 2026</li><li>4 mins</li></ul><p>Short news summary.</p></article>',sources[2]);assert.equal(rows[0].readingMinutes,4);assert.match(rows[0].publishedAt,/2026-10-27/);});

test('newsroom titles are not overwritten by generic read-more links',()=>{
 const html='<article><h2><a href="/news/383-student-opportunities">A useful university student opportunity</a></h2><p>Short summary.</p><time datetime="2026-10-29">October 29, 2026</time><span>3 min read</span><a href="/news/383-student-opportunities">Read full story</a></article>';
 const rows=parsePage(html,sources[1]);assert.equal(rows.length,1);assert.equal(rows[0].title,'A useful university student opportunity');assert.equal(rows[0].readingMinutes,3);assert.match(rows[0].publishedAt,/2026-10-29/);
});
test('collector tries later endpoints after errors or empty pages',async()=>{
 const {collect}=await import('../aggregator.js');const source={...sources[2],endpoints:['https://puredu.net/broken','https://puredu.net/empty','https://puredu.net/']},calls=[];
 const rows=await collect(source,async url=>{calls.push(url);if(url.endsWith('/broken'))return new Response('Unavailable',{status:503});return new Response(url.endsWith('/empty')?'<html></html>':'<article><h3><a href="/post/new-student-update">A newly published student announcement</a></h3></article>');});
 assert.equal(calls.length,3);assert.equal(rows.length,1);
});
test('collector rejects cross-origin redirects and reports a failed live check',async()=>{
 const {collect}=await import('../aggregator.js');await assert.rejects(()=>collect(sources[0],async()=>new Response(null,{status:302,headers:{location:'https://other.test/feed/'}})),/Unsupported source redirect/);
});
