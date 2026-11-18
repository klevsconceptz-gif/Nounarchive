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
 assert.equal(dom.window.document.querySelector('meta[name="robots"]')?.content,'noindex,nofollow');
 assert.doesNotMatch(login.textContent,/First time\?|npm run|ADMIN_PASSWORD|No default password/);
 assert.equal(login.querySelector('input[type=password]').required,true);
 assert.ok(dom.window.document.getElementById('post-form'));
 assert.ok(dom.window.document.querySelector('link[href="/editorial.css"]'));
 }finally{dom.window.close();}
});
test('resource directory preserves records without outbound links and handles no matches',async()=>{
 const resources=JSON.parse(await readFile('public/resources.json','utf8'));
 const dom=new JSDOM(await readFile('public/resources.html','utf8'),{url:'https://nounarchive.test/resources.html',runScripts:'outside-only'});
 try{
 dom.window.fetch=async()=>({ok:true,json:async()=>resources});
 dom.window.eval(await readFile('public/resources.js','utf8'));
 await new Promise(r=>setTimeout(r,10));
 const d=dom.window.document;
 assert.equal(d.querySelectorAll('.resource-card').length,resources.length);
 assert.doesNotMatch(d.body.textContent,/BBCNOUN|NOUN Update|Puredu|Our sources/);
 assert.equal(d.querySelectorAll('.resource-card a.resource-link').length,resources.length);
 assert.ok(d.querySelectorAll('.resource-card a.resource-file-link').length>0);
 assert.ok(resources.length>=50);
 assert.ok(resources.every(item=>item.id&&item.url&&item.source&&item.localTool));
 for(const link of d.querySelectorAll('a[href]'))assert.equal(new URL(link.href).origin,'https://nounarchive.test');
 for(const link of d.querySelectorAll('.resource-card a.resource-link'))assert.match(link.getAttribute('href'),/^\/tool\.html\?id=/);
 for(const link of d.querySelectorAll('.resource-card a.resource-file-link')){const url=new URL(link.href);assert.equal(url.pathname,'/mirror.html');assert.equal(url.searchParams.get('category'),'Study materials');assert.equal(url.searchParams.get('files'),'1');assert.ok(['course','past question'].includes(url.searchParams.get('q')));}
 const select=d.getElementById('resource-category');select.value='Admissions';select.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelectorAll('.resource-card').length,resources.filter(item=>item.category==='Admissions').length);
 const search=d.getElementById('resource-search');search.value='nonexistent resource';search.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelectorAll('.resource-card').length,0);assert.match(d.getElementById('resource-cards').textContent,/No resources found/);
 }finally{dom.window.close();}
});
test('course and past-question shortcuts open file search while results stay a local calculator',async()=>{
 const resourcesDom=new JSDOM(await readFile('public/resources.html','utf8'),{url:'https://nounarchive.test/resources.html'});
 try{
  const d=resourcesDom.window.document;
  const course=new URL(d.querySelector('.resource-file-card[href*="q=course"]').href);
  const past=new URL(d.querySelector('.resource-file-card[href*="q=past%20question"]').href);
  assert.equal(course.pathname,'/mirror.html');assert.equal(course.searchParams.get('files'),'1');assert.equal(course.searchParams.get('category'),'Study materials');assert.equal(course.searchParams.get('q'),'course');
  assert.equal(past.pathname,'/mirror.html');assert.equal(past.searchParams.get('files'),'1');assert.equal(past.searchParams.get('q'),'past question');
  const result=new URL(d.querySelector('.resource-tool-card').href);assert.equal(result.pathname,'/tool.html');assert.equal(result.searchParams.get('id'),'result-checker');
  assert.match(d.querySelector('.resource-file-heading').textContent,/does not look up or publish student records/);
 }finally{resourcesDom.window.close();}
 const home=new JSDOM(await readFile('public/index.html','utf8'),{url:'https://nounarchive.test/'});
 try{
  const d=home.window.document;
  for(const text of ['Course materials','Past questions']){
   const card=[...d.querySelectorAll('.quick-access>a')].find(a=>a.querySelector('strong')?.textContent===text);
   assert.ok(card);const target=new URL(card.href);assert.equal(target.pathname,'/mirror.html');assert.equal(target.searchParams.get('files'),'1');
  }
 }finally{home.window.close();}
});

test('public pages omit admin links but the direct admin panel remains available',async()=>{
 for(const file of ['index.html','resources.html','post.html','mirror.html']){
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
 const w=dom.window;w.fetch=async url=>({ok:true,json:async()=>url==='/api/resources'?{items:resources,refreshMinutes:1440}:({...seed,sources})});w.setInterval=()=>0;
 w.eval(await readFile('public/app.js','utf8'));w.eval(await readFile('public/resources.js','utf8'));await new Promise(r=>setTimeout(r,10));
 const d=w.document;
 assert.doesNotMatch(d.body.textContent,/An independent student news index|Not affiliated with NOUN|Imported articles belong|News from BBCNOUN|TRANSPARENT BY DESIGN|Know where your news comes from|Imported stories link|Source health below|All three sources synced successfully|sources synced successfully|External services are provided by/);
 assert.equal(d.querySelectorAll('#sources,#source-status,.publisher,a[href="#sources"]').length,0);
 assert.equal(d.querySelectorAll('#cards .card').length,6);
 assert.equal(d.querySelectorAll('.resource-card').length,3);
 assert.equal(d.querySelectorAll('#source').length,0);
 assert.equal(d.querySelectorAll('#cards h3 a').length,6);
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
 for(const name of ['index','resources','admin','post','tool','story','mirror']){
 const dom=new JSDOM(await readFile('public/'+name+'.html','utf8'));
 try{const d=dom.window.document;const sheets=[...d.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.getAttribute('href'));assert.equal(sheets.at(-1),name==='mirror'?'/mirror.css':['resources','tool','story'].includes(name)?'/tools.css':'/platform.css');if(name==='index'){const img=d.querySelector('.intro-note img');assert.equal(img.getAttribute('src'),'/student-hub.svg');assert.ok(img.alt);assert.equal(d.querySelectorAll('.platform-actions a').length,2);}}finally{dom.window.close();}
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
 assert.equal(d.querySelectorAll('#cards h3 a').length,2);
 assert.equal(d.querySelector('#cards h3 a[href="/story.html?id=unsafe"]')?.getAttribute('href'),'/story.html?id=unsafe');
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

test('student hub search, quick access and exclusive directory use working internal destinations',async()=>{
 const dom=new JSDOM(await readFile('public/index.html','utf8'),{url:'https://nounarchive.test/',runScripts:'outside-only'});
 try{
 const w=dom.window,seed=JSON.parse(await readFile('data/seed.json','utf8'));w.fetch=async()=>({ok:true,json:async()=>({...seed,sources})});w.setInterval=()=>0;w.matchMedia=()=>({matches:true});w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.eval(await readFile('public/app.js','utf8'));w.eval(await readFile('public/hub.js','utf8'));await new Promise(r=>setTimeout(r,10));
 const d=w.document;assert.equal(d.querySelectorAll('.quick-access>a').length,6);assert.equal(d.querySelectorAll('.student-journey .journey-grid>a').length,3);
 d.getElementById('hub-query').value='cosmetology';d.getElementById('hub-search').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.equal(d.getElementById('search').value,'cosmetology');assert.equal(d.querySelectorAll('#cards .card').length,1);
 const groups=d.querySelectorAll('.directory-groups details');groups[1].open=true;groups[1].dispatchEvent(new w.Event('toggle'));assert.equal(groups[0].open,false);assert.equal(groups[1].open,true);
 for(const a of d.querySelectorAll('a[href]'))assert.equal(new URL(a.href).origin,w.location.origin);
 }finally{dom.window.close();}
});
test('resource directory accepts quick-access search and journey category parameters',async()=>{
 const resources=JSON.parse(await readFile('public/resources.json','utf8'));
 for(const query of ['?q=result','?category=Admissions']){
 const dom=new JSDOM(await readFile('public/resources.html','utf8'),{url:'https://nounarchive.test/resources.html'+query,runScripts:'outside-only'});
 try{
 const w=dom.window;w.fetch=async()=>({ok:true,json:async()=>resources});w.eval(await readFile('public/resources.js','utf8'));await new Promise(r=>setTimeout(r,10));const d=w.document;
 assert.ok(d.querySelectorAll('.resource-card').length>0);
 if(query.includes('Admissions')){assert.equal(d.getElementById('resource-category').value,'Admissions');assert.equal(d.querySelectorAll('.resource-card').length,resources.filter(item=>item.category==='Admissions').length);}else assert.equal(d.getElementById('resource-search').value,'result');
 }finally{dom.window.close();}
 }
});


test('all HTML pages use only same-origin navigation and no automatic redirects',async()=>{
 for(const file of ['index.html','resources.html','post.html','admin.html','tool.html','story.html','mirror.html']){
  const dom=new JSDOM(await readFile('public/'+file,'utf8'),{url:'https://nounarchive.test/'+file});
  try{
   const d=dom.window.document;
   assert.equal(d.querySelectorAll('base, meta[http-equiv="refresh" i]').length,0,file);
   for(const element of d.querySelectorAll('a[href],area[href],form[action],iframe[src]')){
    const target=element.getAttribute('href')??element.getAttribute('action')??element.getAttribute('src');
    const url=new URL(target,dom.window.location.href);
    assert.equal(url.origin,'https://nounarchive.test',file+': '+target);
   }
  }finally{dom.window.close();}
 }
});

test('resource URLs cannot create external navigation or executable markup',async()=>{
 const dom=new JSDOM(await readFile('public/resources.html','utf8'),{url:'https://nounarchive.test/resources.html',runScripts:'outside-only'});
 try{
  const items=['https://outside.test/','//outside.test/','javascript:alert(1)'].map(url=>({title:'Resource',description:'<a href="https://outside.test">text</a>',category:'Admissions',source:'Private origin',url}));
  dom.window.fetch=async()=>({ok:true,json:async()=>items});
  dom.window.eval(await readFile('public/resources.js','utf8'));
  await new Promise(r=>setTimeout(r,10));
  const d=dom.window.document;
  assert.equal(d.querySelectorAll('article.resource-card').length,3);
  assert.equal(d.querySelectorAll('.resource-card a.resource-link').length,3);
  assert.equal(d.querySelectorAll('.resource-card [onclick]').length,0);
  for(const a of d.querySelectorAll('.resource-card a')){assert.match(a.getAttribute('href'),/^\/tool\.html\?id=/);assert.equal(new URL(a.href).origin,'https://nounarchive.test');}
  assert.doesNotMatch(d.body.textContent,/Private origin/);
 }finally{dom.window.close();}
});

test('local content archive searches and opens full text with R2 files through internal routes',async()=>{
 const id='a'.repeat(32),asset='b'.repeat(32);
 const dom=new JSDOM(await readFile('public/mirror.html','utf8'),{url:'https://nounarchive.test/mirror.html?category=Study%20materials&q=course&files=1',runScripts:'outside-only'});
 try{
  const w=dom.window,calls=[];
  w.fetch=async url=>{
   calls.push(String(url));
   if(String(url).startsWith('/api/content?'))return {ok:true,json:async()=>({items:[{id,title:'Course materials and past questions',description:'A local study guide.',excerpt:'Searchable syllabus notes.',publishedAt:'2026-10-20T00:00:00Z',assetCount:1,metadata:{category:'Study materials'}}],hasMore:false,nextOffset:null})};
   return {ok:true,json:async()=>({id,title:'Course materials and past questions',description:'A local study guide.',content:'Full study guide text. <script>must remain text only</script>',metadata:{category:'Study materials'},assets:[{id:asset,fileName:'past-question.pdf',contentType:'application/pdf',byteSize:1024,downloadUrl:'/api/content/assets/'+asset}]})};
  };
  w.eval(await readFile('public/mirror.js','utf8'));await new Promise(resolve=>setTimeout(resolve,15));
  const d=w.document;assert.equal(d.querySelectorAll('.mirror-card').length,1);assert.equal(d.querySelector('.mirror-card h2').textContent,'Course materials and past questions');
  assert.equal(d.getElementById('mirror-files').checked,true);
  const firstSearch=new URL(calls[0],w.location.origin);assert.equal(firstSearch.searchParams.get('files'),'1');assert.equal(firstSearch.searchParams.get('category'),'Study materials');assert.equal(firstSearch.searchParams.get('q'),'course');
  const detailLink=new URL(d.querySelector('.mirror-card a').href,w.location.origin);assert.equal(detailLink.pathname,'/mirror.html');assert.equal(detailLink.searchParams.get('id'),id);assert.equal(detailLink.searchParams.get('files'),'1');assert.equal(detailLink.searchParams.get('q'),'course');
  d.getElementById('mirror-query').value='course';d.getElementById('mirror-search').dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,15));
  assert.ok(calls.some(value=>value.includes('q=course')&&value.includes('files=1')));
  d.getElementById('mirror-clear').click();await new Promise(resolve=>setTimeout(resolve,15));
  const clearedSearch=new URL(calls.at(-1),w.location.origin);assert.equal(clearedSearch.searchParams.has('files'),false);assert.equal(clearedSearch.searchParams.has('category'),false);assert.equal(d.getElementById('mirror-files').checked,false);
  for(const link of d.querySelectorAll('a[href]'))assert.equal(new URL(link.href).origin,w.location.origin);
 }finally{dom.window.close();}
 const detail=new JSDOM(await readFile('public/mirror.html','utf8'),{url:'https://nounarchive.test/mirror.html?q=course&category=Study%20materials&files=1&id='+id,runScripts:'outside-only'});
 try{
  const w=detail.window;w.fetch=async()=>({ok:true,json:async()=>({id,title:'Course materials and past questions',description:'A local study guide.',content:'Full study guide text. <script>must remain text only</script>',metadata:{category:'Study materials'},assets:[{id:asset,fileName:'past-question.pdf',contentType:'application/pdf',byteSize:1024,downloadUrl:'/api/content/assets/'+asset}]})});
  w.eval(await readFile('public/mirror.js','utf8'));await new Promise(resolve=>setTimeout(resolve,15));
  const d=w.document;assert.equal(d.getElementById('mirror-detail').hidden,false);assert.equal(d.getElementById('detail-title').textContent,'Course materials and past questions');
  const backLink=new URL(d.querySelector('.mirror-back').href,w.location.origin);assert.equal(backLink.pathname,'/mirror.html');assert.equal(backLink.searchParams.get('q'),'course');assert.equal(backLink.searchParams.get('files'),'1');
  assert.equal(d.querySelectorAll('#detail-content script').length,0);assert.match(d.getElementById('detail-content').textContent,/must remain text only/);
  assert.equal(d.querySelector('.mirror-asset').getAttribute('href'),'/api/content/assets/'+asset);
  assert.doesNotMatch(d.body.textContent,/BBCNOUN|NOUN Update|Puredu|source tag/i);
  for(const link of d.querySelectorAll('a[href]'))assert.equal(new URL(link.href).origin,w.location.origin);
 }finally{detail.window.close();}
});

test('admin workspace exposes authenticated results import and browsing without public links',async()=>{
 const dom=new JSDOM(await readFile('public/admin.html','utf8'));
 try{
  const d=dom.window.document;assert.equal(d.querySelector('meta[name="robots"]').content,'noindex,nofollow');
  assert.equal(d.getElementById('results-file').getAttribute('accept'),'.csv,.json,text/csv,application/json');
  assert.ok(d.getElementById('results-import'));assert.ok(d.getElementById('results-batch'));assert.ok(d.getElementById('results-delete'));
  assert.match(d.getElementById('student-results-panel').textContent,/encrypted before storage/);
  assert.equal(d.querySelectorAll('a[href*="results"]').length,0);
 }finally{dom.window.close();}
});
