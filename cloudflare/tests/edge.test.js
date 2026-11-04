import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {passwordKey,randomToken} from '../security.js';
const snapshot=JSON.parse(await readFile('data/seed.json','utf8'));
for (const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']]) test(`${label} runtime with D1: auth, drafts, publication, CSRF, logout and throttling`,async()=>{
 const salt=randomToken(),password='test-only-strong-password',hash=`pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash}}));
 try{
 const db=await mf.getD1Database('DB');
 const sql=(await Promise.all(['0001_initial.sql','0002_admin_recovery.sql'].map(name=>readFile('cloudflare/migrations/'+name,'utf8')))).join('\n');
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 let cookie='',csrf='';
 const request=(path,method='GET',body,token=csrf)=>mf.dispatchFetch('https://nounarchive.test/api'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1','X-Nounarchive-Admin':'1','X-CSRF-Token':token,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/health')).status,200);
 assert.equal((await (await request('/archive')).json()).items.length,snapshot.items.length);
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
 const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_admin_recovery.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const request=(path,body,cookie='',admin='1')=>mf.dispatchFetch('https://nounarchive.test/api/admin'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.3','X-Nounarchive-Admin':admin,Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 const login=await request('/login',{password});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/password-reset',{token,newPassword},'','0')).status,403);
 assert.equal((await request('/password-reset',{token:randomToken(),newPassword})).status,400);
 assert.equal((await request('/password-reset',{token,newPassword:'short'})).status,400);
 const results=await Promise.all([request('/password-reset',{token,newPassword}),request('/password-reset',{token,newPassword})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await request('/session',null,cookie)).status,401);
 assert.equal((await request('/login',{password})).status,401);
 const signedIn=await request('/login',{password:newPassword});assert.equal(signedIn.status,200);const newCookie=signedIn.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/password-reset',{token,newPassword:'a different new password'})).status,400);
 assert.equal((await request('/session',null,newCookie)).status,200);
 assert.equal((await request('/password-reset',{token,newPassword})).status,429);
 const row=await db.prepare('SELECT password_hash FROM admin_credentials WHERE id=1').first();assert.notEqual(row.password_hash,hash);assert.ok(await (await import('../security.js')).verifyPassword(newPassword,row.password_hash));
 const used=await db.prepare('SELECT token_hash FROM admin_reset_tokens').first();assert.equal(used.token_hash,await digest(token));assert.notEqual(used.token_hash,token);
 }finally{await mf.dispose();}
});

for(const [label,scriptPath] of [['Worker','dist/worker/worker.js'],['Pages','dist/pages/index.js']])test(`${label} recovery bootstraps an unconfigured runtime only with an owner token`,async()=>{
 const {digest}=await import('../security.js');const token=randomToken();
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath,compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_RESET_TOKEN_HASH:`${Date.now()+900000}$${await digest(token)}`}}));
 try{
 const db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_admin_recovery.sql'])for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 const post=(path,body)=>mf.dispatchFetch('https://nounarchive.test/api/admin'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1'},body:JSON.stringify(body)});
 assert.equal((await post('/login',{password:'not-configured-password'})).status,503);
 assert.equal((await post('/password-reset',{token:'',newPassword:'new-bootstrap-password'})).status,400);
 assert.equal((await post('/password-reset',{token,newPassword:'new-bootstrap-password'})).status,200);
 assert.equal((await post('/login',{password:'new-bootstrap-password'})).status,200);
 }finally{await mf.dispose();}
});
