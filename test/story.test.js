import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {sources} from '../aggregator.js';

 test('imported news opens an internal summary page and saves to the reading list',async()=>{
  const archive=JSON.parse(await readFile('data/seed.json','utf8'));
  const item=archive.items[0];
  const dom=new JSDOM(await readFile('public/story.html','utf8'),{url:`https://nounarchive.test/story.html?id=${item.id}`,runScripts:'outside-only'});
  try{
   const w=dom.window;w.fetch=async()=>({ok:true,json:async()=>({...archive,sources})});
   w.eval(await readFile('public/story.js','utf8'));await new Promise(resolve=>setTimeout(resolve,10));
   const d=w.document;
   assert.equal(d.querySelector('#story-content h1').textContent,item.title);
   assert.ok(d.getElementById('story-content').textContent.includes(item.excerpt));
   assert.doesNotMatch(d.body.textContent,/puredu\.net|bbcnoun\.com\.ng|nounupdate\.com/i);
   for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,w.location.origin);
   const save=d.getElementById('save-story');save.click();assert.equal(save.getAttribute('aria-pressed'),'true');
   assert.ok(JSON.parse(w.localStorage.getItem('nounarchive-saved')).includes(item.id));
  }finally{dom.window.close();}
 });
