import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resourceSources,parseResourcePage,collectResources} from '../aggregator.js';

test('resource discovery extracts local tool metadata and rejects news, generic, and off-site links',()=>{
 const source=resourceSources.find(item=>item.id==='nounupdate');
 const html='<section id="all-services"><a href="/cgpa-calculator">CGPA Calculator</a><a href="/file-resizer/">File Resizer</a><a href="/news/388-exam-timetable">Exam timetable news</a><a href="https://other.test/result">Result Checker</a><a href="/contact.php">Contact</a><a href="/cgpa-calculator">CGPA Calculator</a></section>';
 const rows=parseResourcePage(html,source);
 assert.equal(rows.length,2);
 assert.equal(rows[0].title,'CGPA Calculator');
 assert.equal(rows[0].localTool,'grades');
 assert.equal(rows[1].localTool,'file-resizer');
 assert.ok(rows.every(item=>new URL(item.url).origin==='https://nounupdate.com'));
 assert.ok(rows.every(item=>item.id&&item.description&&!item.href));
});

test('BBCNOUN-listed external services are stored only as metadata and classified as local tools',()=>{
 const source=resourceSources.find(item=>item.id==='bbcnoun');
 const rows=parseResourcePage('<nav><a href="https://nounsummary.com/">Noun summary</a><a href="https://nounelearn.com/">Mock E-exam (CBT)</a><a href="mailto:help@example.test">Support</a></nav>',source);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(item=>item.localTool),['notes','practice']);
 assert.deepEqual(rows.map(item=>new URL(item.url).origin),['https://nounsummary.com','https://nounelearn.com']);
});

test('resource collection rejects cross-origin redirects',async()=>{
 const source=resourceSources.find(item=>item.id==='bbcnoun');
 await assert.rejects(()=>collectResources(source,async()=>new Response(null,{status:302,headers:{location:'https://other.test/'}})),/Unsupported source redirect/);
});
