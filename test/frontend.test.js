import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {sources} from '../aggregator.js';
test('publication homepage renders lead, metadata, filtering, bookmarks and pagination',async()=>{
 const html=await readFile('public/index.html','utf8');const script=await readFile('public/app.js','utf8');const seed=JSON.parse(await readFile('data/seed.json','utf8'));
 const dom=new JSDOM(html,{url:'http://nounarchive.test/',runScripts:'outside-only'});
 try{
 const {window}=dom;window.fetch=async()=>({ok:true,json:async()=>({...seed,sources})});window.setInterval=()=>0;window.HTMLElement.prototype.scrollIntoView=()=>{};
 window.eval(script);await new Promise(r=>setTimeout(r,10));
 const document=window.document;
 assert.equal(document.querySelectorAll('.lead-story').length,1);
 assert.equal(document.querySelectorAll('#cards .card').length,6);
 assert.match(document.getElementById('featured').textContent,/4 min read/);
 assert.match(document.querySelector('.story-meta').textContent,/Category:/);
 document.getElementById('load-more').click();assert.equal(document.querySelectorAll('#cards .card').length,Math.min(12,seed.items.length));
 document.getElementById('load-more').click();assert.equal(document.querySelectorAll('#cards .card').length,seed.items.length);
 assert.equal(document.querySelectorAll('.topic-card').length,3);
 const search=document.getElementById('search');search.value='cosmetology';search.dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('#cards .card').length,1);
 document.querySelector('[data-save]').click();assert.equal(document.getElementById('saved-count').textContent,'1');
 document.getElementById('clear').click();const source=document.getElementById('source');source.value='nounupdate';source.dispatchEvent(new window.Event('change'));assert.equal(document.querySelectorAll('#cards .card').length,0);assert.match(document.getElementById('cards').textContent,/No updates found/);
 }finally{dom.window.close();}
});
test('login screen omits setup instructions while preserving password login and editor',async()=>{
 const dom=new JSDOM(await readFile('public/admin.html','utf8'));
 try{
 const login=dom.window.document.getElementById('login-panel');
 assert.doesNotMatch(login.textContent,/First time\?|npm run|ADMIN_PASSWORD|No default password/);
 assert.equal(login.querySelector('input[type=password]').required,true);
 assert.ok(dom.window.document.getElementById('post-form'));
 assert.ok(dom.window.document.querySelector('link[href="/editorial.css"]'));
 }finally{dom.window.close();}
});
test('resource directory filters reviewed external links and handles no matches',async()=>{
 const resources=JSON.parse(await readFile('public/resources.json','utf8'));
 const dom=new JSDOM(await readFile('public/resources.html','utf8'),{url:'https://nounarchive.test/resources.html',runScripts:'outside-only'});
 try{
 dom.window.fetch=async()=>({ok:true,json:async()=>resources});
 dom.window.eval(await readFile('public/resources.js','utf8'));
 await new Promise(r=>setTimeout(r,10));
 const d=dom.window.document;
 assert.equal(d.querySelectorAll('.resource-card').length,19);
 for(const link of d.querySelectorAll('.resource-card')){assert.match(link.href,/^https:\/\/(nounupdate\.com|bbcnoun\.com\.ng|puredu\.net)\//);assert.equal(link.getAttribute('rel'),'noopener noreferrer');}
 const select=d.getElementById('resource-category');select.value='Admissions';select.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.resource-card').length,4);
 const search=d.getElementById('resource-search');search.value='nonexistent resource';search.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelectorAll('.resource-card').length,0);assert.match(d.getElementById('resource-cards').textContent,/No resources found/);
 }finally{dom.window.close();}
});
