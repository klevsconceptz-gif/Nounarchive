import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {passwordKey,randomToken} from '../security.js';
const snapshot=JSON.parse(await readFile('data/seed.json','utf8'));
for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} readiness requires every D1 migration`,async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']}));
 try{
  const health=()=>mf.dispatchFetch('https://nounarchive.test/api/health');
  let response=await health();assert.equal(response.status,503);assert.equal((await response.json()).ok,false);
  const archiveResponse=await mf.dispatchFetch('https://nounarchive.test/api/archive');
  assert.equal(archiveResponse.status,200);assert.deepEqual((await archiveResponse.json()).items,snapshot.items);
  const db=await mf.getD1Database('DB');
  await db.prepare('CREATE TABLE articles (id TEXT PRIMARY KEY, source TEXT NOT NULL, published_at TEXT, data TEXT NOT NULL)').run();
  const saved={id:'partial-schema-story',source:'nounupdate',title:'Saved archive item',url:'/',excerpt:'This saved item survives unavailable D1 tables.',publishedAt:'2026-11-01T00:00:00.000Z',category:'Campus news'};
  await db.prepare('INSERT INTO articles(id,source,published_at,data) VALUES(?,?,?,?)').bind(saved.id,saved.source,saved.publishedAt,JSON.stringify(saved)).run();
  const partialArchive=await (await mf.dispatchFetch('https://nounarchive.test/api/archive')).json();
  assert.equal(partialArchive.items.length,snapshot.items.length+1);assert.ok(partialArchive.items.some(item=>item.id===saved.id));
  for(const file of ['0001_initial.sql','0002_admin_recovery.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await (await mf.getD1Database('DB')).prepare(sql).run();
  response=await health();assert.equal(response.status,503);
  for(const sql of (await readFile('cloudflare/migrations/0003_resources.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await (await mf.getD1Database('DB')).prepare(sql).run();
  response=await health();assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,database:'d1'});
 }finally{await mf.dispose();}
});
for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} public archive serves the bundled snapshot without D1`,async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat']}));
 try{
  const response=await mf.dispatchFetch('https://nounarchive.test/api/archive');
  assert.equal(response.status,200);assert.deepEqual((await response.json()).items,snapshot.items);
  const resourcesResponse=await mf.dispatchFetch('https://nounarchive.test/api/resources');
  assert.equal(resourcesResponse.status,200);assert.ok((await resourcesResponse.json()).items.length>=50);
  assert.equal((await mf.dispatchFetch('https://nounarchive.test/api/health')).status,503);
 }finally{await mf.dispose();}
});
for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} serves the KV news and resources archive without D1`,async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],kvNamespaces:{kv:'test-kv'}}));
 try{
  const kv=await mf.getKVNamespace('kv');
  const news={id:'kv-only-news',source:'bbcnoun',title:'Headline delivered from the KV archive',url:'https://bbcnoun.com.ng/kv-only',excerpt:'KV content remains available without a D1 binding.',publishedAt:'2026-11-12T00:00:00.000Z',category:'Campus news'};
  const newsStatus={state:'ok',checkedAt:'2026-11-12T00:00:00.000Z',lastSuccess:'2026-11-12T00:00:00.000Z',message:'1 articles found'};
  await kv.put('nounarchive:news:v1:bbcnoun',JSON.stringify({version:1,updatedAt:newsStatus.checkedAt,items:[news],status:newsStatus}));
  const resource={id:'kv-only-resource',title:'KV local study resource',category:'Study & examinations',url:'https://bbcnoun.com.ng/study',source:'BBCNOUN',localTool:'practice',description:'Use the local practice workspace.'};
  await kv.put('nounarchive:resources:v1:bbcnoun',JSON.stringify({version:1,updatedAt:newsStatus.checkedAt,items:[resource],status:newsStatus}));
  const archiveResponse=await mf.dispatchFetch('https://nounarchive.test/api/archive');
  assert.equal(archiveResponse.status,200);const archive=await archiveResponse.json();
  assert.ok(archive.items.some(item=>item.id===news.id));assert.deepEqual(archive.status.bbcnoun,newsStatus);
  const resourcesResponse=await mf.dispatchFetch('https://nounarchive.test/api/resources');
  assert.equal(resourcesResponse.status,200);const resources=await resourcesResponse.json();
  assert.ok(resources.items.some(item=>item.id===resource.id));assert.deepEqual(resources.status.bbcnoun,newsStatus);
  assert.equal(resources.lastSuccess,newsStatus.lastSuccess);
  assert.equal((await mf.dispatchFetch('https://nounarchive.test/api/health')).status,503);
 }finally{await mf.dispose();}
});

test('daily Worker collection persists all news and resource sources to KV without D1',async()=>{
 const html=(href,title)=>`<html><body><article><h2><a href="${href}">${title}</a></h2><p>Mocked local excerpt</p><time datetime="2026-11-12"></time></article><a href="/resources">Student course and study resources</a></body></html>`;
 const outboundService=async request=>{
  const url=new URL(request.url);
  if(url.hostname==='bbcnoun.com.ng'&&url.pathname==='/feed/')return new Response('<rss><channel><item><title>BBCNOUN announces a new mock headline today</title><link>https://bbcnoun.com.ng/news/mock-bbc</link><description>Mock feed excerpt</description><pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>');
  if(url.hostname==='bbcnoun.com.ng')return new Response(html('/resources/bbc-mock','BBCNOUN course resources catalogue'));
  if(url.hostname==='nounupdate.com'&&url.pathname==='/news/')return new Response(html('/news/mock-nounupdate','NOUN Update reports a new mock daily headline'));
  if(url.hostname==='nounupdate.com')return new Response(html('/resources/nounupdate-mock','NOUN Update student course catalogue'));
  if(url.hostname==='puredu.net')return new Response(html('/post/mock-puredu','Puredu announces a new mock campus headline'));
  return new Response('Unexpected mock source: '+url.href,{status:404});
 };
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/worker.js',compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat','service_binding_extra_handlers'],kvNamespaces:{kv:'test-kv'},outboundService:outboundService}));
 try{
  const worker=await mf.getWorker();
  const result=await worker.scheduled({scheduledTime:new Date(),cron:'0 0 * * *'});
  assert.equal(result.outcome,'ok');
  const kv=await mf.getKVNamespace('kv');
  for(const [source,title] of [['bbcnoun','BBCNOUN announces a new mock headline today'],['nounupdate','NOUN Update reports a new mock daily headline'],['puredu','Puredu announces a new mock campus headline']]){
   const document=JSON.parse(await kv.get('nounarchive:news:v1:'+source));
   assert.ok(document.items.some(item=>item.title===title));assert.equal(document.status.state,'ok');
  }
  for(const [source,title] of [['bbcnoun','BBCNOUN course resources catalogue'],['nounupdate','NOUN Update student course catalogue']]){
   const document=JSON.parse(await kv.get('nounarchive:resources:v1:'+source));
   assert.ok(document.items.some(item=>item.title===title),`${source}: ${document.items.map(item=>item.title).join(' | ')}`);assert.equal(document.status.state,'ok');
  }
  const archive=await (await mf.dispatchFetch('https://nounarchive.test/api/archive')).json();
  assert.ok(archive.items.some(item=>item.title==='NOUN Update reports a new mock daily headline'));
 }finally{await mf.dispose();}
});

test('daily Worker refresh mirrors collected records to D1 when available',async()=>{
 const mockHtml='<html><body><article><h2><a href="/resources/mock-course">BBCNOUN course materials archive</a></h2><p>Mocked course materials summary.</p></article></body></html>';
 const outboundService=async request=>{
  const url=new URL(request.url);
  if(url.hostname==='bbcnoun.com.ng'&&url.pathname==='/feed/')return new Response('<rss><channel><item><title>BBCNOUN daily D1 mirror headline</title><link>https://bbcnoun.com.ng/news/d1-mirror</link><description>Mock feed excerpt</description></item></channel></rss>');
  if(url.hostname==='bbcnoun.com.ng')return new Response(mockHtml);
  return new Response('Source unavailable in D1 mirror test.',{status:503});
 };
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/worker.js',compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat','service_binding_extra_handlers'],d1Databases:['DB'],kvNamespaces:{kv:'test-kv'},outboundService}));
 try{
  const db=await mf.getD1Database('DB');
  for(const sql of [
   'CREATE TABLE articles(id TEXT PRIMARY KEY,source TEXT NOT NULL,published_at TEXT,data TEXT NOT NULL)',
   'CREATE TABLE source_status(source TEXT PRIMARY KEY,data TEXT NOT NULL)',
   'CREATE TABLE resources(id TEXT PRIMARY KEY,source TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL)',
   'CREATE TABLE resource_status(source TEXT PRIMARY KEY,data TEXT NOT NULL)',
   'CREATE TABLE admin_sessions(expires INTEGER)',
   'CREATE TABLE login_attempts(expires INTEGER)'
  ])await db.prepare(sql).run();
  const result=await (await mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'0 0 * * *'});
  assert.equal(result.outcome,'ok');
  const articles=(await db.prepare('SELECT data FROM articles').all()).results.map(row=>JSON.parse(row.data));
  assert.ok(articles.some(item=>item.title==='BBCNOUN daily D1 mirror headline'));
  const resources=(await db.prepare('SELECT data FROM resources').all()).results.map(row=>JSON.parse(row.data));
  assert.ok(resources.some(item=>item.title==='BBCNOUN course materials archive'));
  const kv=await mf.getKVNamespace('kv');
  assert.ok(await kv.get('nounarchive:news:v1:bbcnoun'));assert.ok(await kv.get('nounarchive:resources:v1:bbcnoun'));
 }finally{await mf.dispose();}
});

for (const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']]) test(`${label} runtime with D1: auth, drafts, publication, CSRF, logout and throttling`,async()=>{
 const salt=randomToken(),password='test-only-strong-password',hash=`pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash}}));
 try{
 const db=await mf.getD1Database('DB');
 const sql=(await Promise.all(['0001_initial.sql','0002_admin_recovery.sql','0003_resources.sql'].map(name=>readFile('cloudflare/migrations/'+name,'utf8')))).join('\n');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 let cookie='',csrf='';
 const request=(path,method='GET',body,token=csrf)=>mf.dispatchFetch('https://nounarchive.test/api'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1','X-Nounarchive-Admin':'1','X-CSRF-Token':token,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/health')).status,200);
 const archiveResponse=await request('/archive');const archive=await archiveResponse.json();assert.equal(archive.items.length,snapshot.items.length);assert.equal(archive.refreshMinutes,1440);
 const resourceResponse=await request('/resources');assert.equal(resourceResponse.status,200);const resourceArchive=await resourceResponse.json();assert.ok(resourceArchive.items.length>=50);assert.ok(resourceArchive.items.every(item=>item.id&&item.url&&item.localTool));
 assert.equal((await request('/admin/posts')).status,401);
 const login=await request('/admin/login','POST',{password});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Secure/);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
 const fields={title:'A direct community announcement',content:'Useful information published directly for NOUN students.',category:'Campus news',status:'draft'};
 assert.equal((await request('/admin/posts','POST',fields,'invalid')).status,403);
 const created=await request('/admin/posts','POST',fields);assert.equal(created.status,201);const post=await created.json();
 assert.equal((await request('/posts/'+post.id)).status,404);
 assert.equal((await request('/admin/posts/'+post.id,'PUT',{...fields,status:'published'})).status,200);
 assert.equal((await request('/posts/'+post.id)).status,200);
 assert.equal((await (await request('/archive')).json()).items.length,snapshot.items.length+1);
 assert.equal((await request('/admin/posts/'+post.id,'PUT',fields)).status,200);assert.equal((await request('/posts/'+post.id)).status,404);
 assert.equal((await request('/admin/posts/'+post.id,'DELETE')).status,200);
 assert.equal((await request('/admin/logout','POST')).status,200);assert.equal((await request('/admin/posts')).status,401);
 for(let i=0;i<5;i++)assert.equal((await request('/admin/login','POST',{password:'wrong'})).status,401);
 assert.equal((await request('/admin/login','POST',{password})).status,429);
 }finally{await mf.dispose();}
});

for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} recovery: atomic token consumption, session invalidation and persistent new credential`,async()=>{
 const {digest}=await import('../security.js');
 const token=randomToken(),password='old-strong-test-password',newPassword='new-strong-test-password',salt=randomToken();
 const hash=`pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash,ADMIN_RESET_TOKEN_HASH:`${Date.now()+900000}$${await digest(token)}`}}));
 try{
 const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_admin_recovery.sql','0003_resources.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const request=(path,body,cookie='',admin='1')=>mf.dispatchFetch('https://nounarchive.test/api/admin'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.3','X-Nounarchive-Admin':admin,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const login=await request('/login',{password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/password-reset',{token,newPassword},'','0')).status,403);
 assert.equal((await request('/password-reset',{token:randomToken(),newPassword})).status,400);
 assert.equal((await request('/password-reset',{token,newPassword:'short'})).status,400);
 const results=await Promise.all([request('/password-reset',{token,newPassword}),request('/password-reset',{token,newPassword})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await request('/session',null,cookie)).status,401);
 assert.equal((await request('/login',{password})).status,401);
 const signedIn=await request('/login',{password:newPassword});assert.equal(signedIn.status,200);const newCookie=signedIn.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/session',null,newCookie)).status,200);
 assert.equal((await request('/password-reset',{token,newPassword:'a different new password'})).status,400);
 const row=await db.prepare('SELECT password_hash FROM admin_credentials WHERE id=1').first();assert.notEqual(row.password_hash,hash);assert.ok(await (await import('../security.js')).verifyPassword(newPassword,row.password_hash));
 const used=await db.prepare('SELECT token_hash FROM admin_reset_tokens').first();assert.equal(used.token_hash,await digest(token));assert.notEqual(used.token_hash,token);
 }finally{await mf.dispose();}
});

for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} successful recovery clears the recovery rate-limit bucket`,async()=>{
 const {digest}=await import('../security.js');const token=randomToken(),newPassword='fresh-recovery-password';
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_RESET_TOKEN_HASH:`${Date.now()+900000}$${await digest(token)}`}}));
 try{
  const db=await mf.getD1Database('DB');
  for(const file of ['0001_initial.sql','0002_admin_recovery.sql','0003_resources.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
  const request=body=>mf.dispatchFetch('https://nounarchive.test/api/admin/password-reset',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.4','X-Nounarchive-Admin':'1'},body:JSON.stringify(body)});
  for(let i=0;i<2;i++)assert.equal((await request({token:randomToken(),newPassword})).status,400);
  assert.equal((await request({token,newPassword})).status,200);
  const resetIpHash=await digest('reset:192.0.2.4');
  assert.equal(await db.prepare('SELECT ip_hash FROM login_attempts WHERE ip_hash=?').bind(resetIpHash).first(),null);
  for(let i=0;i<5;i++)assert.equal((await request({token,newPassword})).status,400);
  assert.equal((await request({token,newPassword})).status,429);
 }finally{await mf.dispose();}
});

for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} recovery bootstraps an unconfigured runtime only with an owner token`,async()=>{
 const {digest}=await import('../security.js');const token=randomToken();
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_RESET_TOKEN_HASH:`${Date.now()+900000}$${await digest(token)}`}}));
 try{
 const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_admin_recovery.sql','0003_resources.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const post=(path,body)=>mf.dispatchFetch('https://nounarchive.test/api/admin'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1'},body:JSON.stringify(body)});
 assert.equal((await post('/login',{password:'not-configured-password'})).status,503);
 assert.equal((await post('/password-reset',{token:'',newPassword:'new-bootstrap-password'})).status,400);
 assert.equal((await post('/password-reset',{token,newPassword:'new-bootstrap-password'})).status,200);
 assert.equal((await post('/login',{password:'new-bootstrap-password'})).status,200);
 }finally{await mf.dispose();}
});
