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
 document.getElementById('load-more').click();assert.equal(document.querySelectorAll('#cards .card').length,10);
 const search=document.getElementById('search');search.value='cosmetology';search.dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('#cards .card').length,1);
 document.querySelector('[data-save]').click();assert.equal(document.getElementById('saved-count').textContent,'1');
 document.getElementById('clear').click();const source=document.getElementById('source');source.value='nounupdate';source.dispatchEvent(new window.Event('change'));assert.equal(document.querySelectorAll('#cards .card').length,0);assert.match(document.getElementById('cards').textContent,/No updates found/);
 }finally{dom.window.close();}
});
