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
 const sql=await readFile('cloudflare/migrations/0001_initial.sql','utf8');
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
