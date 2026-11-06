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
 assert.equal(document.querySelectorAll('.feature-illustration svg').length,1);
 assert.equal(document.querySelectorAll('#cards .art-icon svg').length,6);
 assert.equal(document.querySelectorAll('#cards .card').length,6);
 assert.match(document.getElementById('featured').textContent,/4 min read/);
 assert.match(document.querySelector('.story-meta').textContent,/Category:/);
 document.getElementById('load-more').click();assert.equal(document.querySelectorAll('#cards .card').length,Math.min(12,seed.items.length));
 document.getElementById('load-more').click();assert.equal(document.querySelectorAll('#cards .card').length,seed.items.length);
 assert.equal(document.querySelectorAll('.topic-card').length,3);
 const search=document.getElementById('search');search.value='cosmetology';search.dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('#cards .card').length,1);
 document.querySelector('[data-save]').click();assert.equal(document.getElementById('saved-count').textContent,'1');
 document.getElementById('clear').click();document.querySelector('[data-category=Admissions]').click();assert.equal(document.querySelectorAll('#cards .card').length,seed.items.filter(i=>i.category==='Admissions').length);search.value='not-a-real-headline';search.dispatchEvent(new window.Event('input'));assert.equal(document.querySelectorAll('#cards .card').length,0);assert.match(document.getElementById('cards').textContent,/No updates found/);
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
 assert.doesNotMatch(d.body.textContent,/BBCNOUN|NOUN Update|Puredu|Our sources/);
 for(const tag of d.querySelectorAll('.resource-link'))assert.equal(tag.textContent,'Open resource↗');
 for(const link of d.querySelectorAll('.resource-card')){assert.match(link.href,/^https:\/\/(nounupdate\.com|bbcnoun\.com\.ng|puredu\.net)\//);assert.equal(link.getAttribute('rel'),'noopener noreferrer');}
 const select=d.getElementById('resource-category');select.value='Admissions';select.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.resource-card').length,4);
 const search=d.getElementById('resource-search');search.value='nonexistent resource';search.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelectorAll('.resource-card').length,0);assert.match(d.getElementById('resource-cards').textContent,/No resources found/);
 }finally{dom.window.close();}
});
test('public pages omit admin links but the direct admin panel remains available',async()=>{
 for(const file of ['index.html','resources.html','post.html']){
 const dom=new JSDOM(await readFile('public/'+file,'utf8'));try{assert.equal(dom.window.document.querySelectorAll('a[href*="admin"]').length,0,file);}finally{dom.window.close();}
 }
 const dom=new JSDOM(await readFile('public/admin.html','utf8'));try{assert.ok(dom.window.document.getElementById('login-form'));assert.ok(dom.window.document.getElementById('post-form'));}finally{dom.window.close();}
});
test('landing page omits outbound links, publisher banners, badges and claims',async()=>{
 const html=await readFile('public/index.html','utf8');
 const seed=JSON.parse(await readFile('data/seed.json','utf8'));
 const dom=new JSDOM(html,{url:'https://nounarchive.test/',runScripts:'outside-only'});
 try{
 const resources=JSON.parse(await readFile('public/resources.json','utf8'));
 const w=dom.window;w.fetch=async url=>({ok:true,json:async()=>url==='/resources.json'?resources:({...seed,sources})});w.setInterval=()=>0;
 w.eval(await readFile('public/app.js','utf8'));w.eval(await readFile('public/resources.js','utf8'));await new Promise(r=>setTimeout(r,10));
 const d=w.document;
 assert.doesNotMatch(d.body.textContent,/An independent student news index|Not affiliated with NOUN|Imported articles belong|News from BBCNOUN|TRANSPARENT BY DESIGN|Know where your news comes from|Imported stories link|Source health below|All three sources synced successfully|sources synced successfully|External services are provided by/);
 assert.equal(d.querySelectorAll('#sources,#source-status,.publisher,a[href="#sources"]').length,0);
 assert.equal(d.querySelectorAll('#cards .card').length,6);
 assert.equal(d.querySelectorAll('.resource-card').length,3);
 assert.equal(d.querySelectorAll('#source,#cards h3 a').length,0);
 assert.doesNotMatch(d.body.textContent,/BBCNOUN|NOUN Update|Puredu|Browse by source|News publisher/);
 for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,w.location.origin,a.outerHTML);
 d.getElementById('load-more').click();
 for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,w.location.origin,a.outerHTML);
 const q=d.getElementById('search');q.value='not-a-real-headline';q.dispatchEvent(new w.Event('input'));
 assert.match(d.getElementById('cards').textContent,/No updates found/);
 assert.doesNotMatch(d.getElementById('cards').textContent,/status below/);
 }finally{dom.window.close();}
});

test('student-platform theme is shared across pages with an original responsive hero graphic',async()=>{
 for(const name of ['index','resources','admin','post']){
 const dom=new JSDOM(await readFile('public/'+name+'.html','utf8'));
 try{const d=dom.window.document;const sheets=[...d.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.getAttribute('href'));assert.equal(sheets.at(-1),'/platform.css');if(name==='index'){const img=d.querySelector('.intro-note img');assert.equal(img.getAttribute('src'),'/student-hub.svg');assert.ok(img.alt);assert.equal(d.querySelectorAll('.platform-actions a').length,2);}}finally{dom.window.close();}
 }
 const svg=await readFile('public/student-hub.svg','utf8');assert.match(svg,/viewBox="0 0 620 460"/);assert.doesNotMatch(svg,/<script/i);
});

test('homepage preserves internal editorial links but never links to foreign or unsafe destinations',async()=>{
 const dom=new JSDOM(await readFile('public/index.html','utf8'),{url:'https://nounarchive.test/',runScripts:'outside-only'});
 try{
 const w=dom.window;const items=[
 {id:'own',source:'nounarchive',title:'Original student announcement',url:'/post.html?id='+'a'.repeat(24),category:'Campus news',publishedAt:'2026-11-03T00:00:00Z'},
 {id:'double-slash',source:'nounarchive',title:'Ambiguous path must not be linked',url:'https://nounarchive.test//other.test/path',category:'Academics'},
 {id:'foreign',source:'nounarchive',title:'Foreign destination must not be linked',url:'https://other.test/post',category:'Admissions'},
 {id:'unsafe',source:'puredu',title:'Unsafe destination must not be linked',url:'javascript:alert(1)',category:'Examinations'}
 ];w.fetch=async()=>({ok:true,json:async()=>({items,sources:[],status:{}})});w.setInterval=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.eval(await readFile('public/app.js','utf8'));await new Promise(r=>setTimeout(r,10));
 const d=w.document;assert.equal(d.querySelector('#featured h2 a').getAttribute('href'),items[0].url);
 assert.equal(d.querySelectorAll('#cards h3 a').length,1);
 for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,w.location.origin);
 d.querySelector('[data-save="own"]').click();d.getElementById('saved-nav').click();assert.equal(d.querySelectorAll('#cards .card').length,1);
 }finally{dom.window.close();}
});

test('admin recovery form validates confirmation, posts tokens only in request body, and returns to login',async()=>{
 const dom=new JSDOM(await readFile('public/admin.html','utf8'),{url:'https://nounarchive.test/admin.html',runScripts:'outside-only'});
 try{
 const w=dom.window,calls=[];w.fetch=async(url,options={})=>{calls.push({url,...options});return url.endsWith('/password-reset')?{ok:true,json:async()=>({ok:true})}:{ok:false,status:401,json:async()=>({error:'Please sign in.'})};};
 w.eval(await readFile('public/admin-client.js','utf8'));await new Promise(r=>setTimeout(r,10));
 const d=w.document;assert.equal(d.getElementById('reset-panel').hidden,true);d.getElementById('open-reset').click();assert.equal(d.getElementById('login-panel').hidden,true);assert.equal(d.getElementById('reset-panel').hidden,false);
 d.getElementById('reset-token').value='a'.repeat(64);d.getElementById('new-password').value='test-new-password';d.getElementById('confirm-password').value='not-the-same-password';
 const form=d.getElementById('reset-form'),button=form.querySelector('[type=submit]');
 form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));assert.match(d.getElementById('message').textContent,/do not match/);assert.equal(calls.filter(c=>c.url.endsWith('/password-reset')).length,0);
 d.getElementById('confirm-password').value='test-new-password';form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));await new Promise(r=>setTimeout(r,10));
 const call=calls.find(c=>c.url.endsWith('/password-reset'));assert.equal(call.url,'/api/admin/password-reset');assert.equal(call.method,'POST');assert.equal(call.headers['X-Nounarchive-Admin'],'1');assert.deepEqual(JSON.parse(call.body),{token:'a'.repeat(64),newPassword:'test-new-password'});
 assert.equal(d.getElementById('login-panel').hidden,false);assert.equal(d.getElementById('reset-panel').hidden,true);assert.equal(d.getElementById('reset-token').value,'');assert.equal(d.getElementById('new-password').value,'');assert.match(d.getElementById('message').textContent,/Password reset/);
 }finally{dom.window.close();}
});

test('archive failures omit connection copy, clear initial placeholders and preserve loaded stories',async()=>{
 const html=await readFile('public/index.html','utf8'),script=await readFile('public/app.js','utf8');
 const seed=JSON.parse(await readFile('data/seed.json','utf8'));
 for(const mode of ['network','http','refresh']){
 const dom=new JSDOM(html,{url:'https://nounarchive.test/',runScripts:'outside-only'});
 try{
 const w=dom.window;let fail=mode!=='refresh',refresh;
 w.setInterval=fn=>{refresh=fn;return 0;};
 w.fetch=async()=>{if(fail){if(mode==='http')return {ok:false};throw Error('Network unavailable');}return {ok:true,json:async()=>({...seed,sources})};};
 w.eval(script);await new Promise(r=>setTimeout(r,10));const d=w.document;
 if(mode==='refresh'){
 const cards=d.getElementById('cards').innerHTML,featured=d.getElementById('featured').innerHTML,count=d.getElementById('result-count').textContent;
 assert.ok(d.querySelector('.lead-story'));fail=true;await refresh();
 assert.equal(d.getElementById('cards').innerHTML,cards);assert.equal(d.getElementById('featured').innerHTML,featured);assert.equal(d.getElementById('result-count').textContent,count);
 }else{assert.equal(d.getElementById('result-count').textContent,'');assert.equal(d.getElementById('featured').textContent,'');}
 assert.equal(d.getElementById('notice').textContent,'');assert.doesNotMatch(d.body.textContent,/Connection unavailable|The archive is temporarily unavailable|The latest story is temporarily unavailable/);
 }finally{dom.window.close();}
 }
});

test('public pages omit disclaimer copy while retaining admin security guidance',async()=>{
 for(const name of ['index','resources','post']){
 const dom=new JSDOM(await readFile('public/'+name+'.html','utf8'));
 try{const d=dom.window.document;assert.equal(d.querySelectorAll('.resource-disclaimer').length,0);assert.doesNotMatch(d.body.textContent,/not affiliated|independent student|original providers|not these external services|not guaranteed|confirm time-sensitive/i);}finally{dom.window.close();}
 }
 const resources=JSON.parse(await readFile('public/resources.json','utf8'));
 for(const item of resources)assert.doesNotMatch(item.description,/verify payable|confirm eligibility and deadlines at source/i);
 const admin=new JSDOM(await readFile('public/admin.html','utf8'));
 try{assert.match(admin.window.document.getElementById('reset-panel').textContent,/Tokens expire after 15 minutes/);}finally{admin.window.close();}
});
