import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installAdmin} from '../admin.js';
test('admin lifecycle protects drafts, enforces CSRF, persists publication and deletion',async()=>{
 const original=process.cwd(), previous=process.env.ADMIN_PASSWORD;
 const dir=await mkdtemp(join(tmpdir(),'nounarchive-test-')); process.chdir(dir);process.env.ADMIN_PASSWORD='test-only-password-long';
 let server;
 try{
 const app=express();app.use(express.json());const admin=await installAdmin(app);
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api`;
 let cookie='',csrf='';
 const request=(path,method='GET',body,authenticated=true,withCsrf=true)=>fetch(base+path,{method,headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1',...(authenticated?{Cookie:cookie}:{}),...(withCsrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await request('/admin/posts')).status,401);
 assert.equal((await request('/admin/login','POST',{password:'wrong'})).status,401);
 let response=await request('/admin/login','POST',{password:'test-only-password-long'});assert.equal(response.status,200);
 cookie=response.headers.get('set-cookie').split(';')[0];csrf=(await response.json()).csrf;
 const fields={title:'An important campus notice',content:'This is a full direct update for the NOUN student community.',category:'Campus news',status:'draft'};
 assert.equal((await request('/admin/posts','POST',fields,true,false)).status,403);
 response=await request('/admin/posts','POST',fields);assert.equal(response.status,201);const post=await response.json();
 assert.equal((await request('/posts/'+post.id,'GET',null,false)).status,404);assert.equal(admin.published().length,0);
 await request('/admin/posts/'+post.id,'PUT',{...fields,status:'published'});
 assert.equal((await request('/posts/'+post.id,'GET',null,false)).status,200);assert.equal(admin.published().length,1);
 const app2=express();const reloaded=await installAdmin(app2);assert.equal(reloaded.published().length,1);
 await request('/admin/posts/'+post.id,'PUT',fields);assert.equal((await request('/posts/'+post.id,'GET',null,false)).status,404);
 await request('/admin/posts/'+post.id,'DELETE');assert.equal((await (await request('/admin/posts')).json()).length,0);
 await request('/admin/logout','POST');assert.equal((await request('/admin/posts')).status,401);
 } finally {if(server)await new Promise(r=>server.close(r));process.chdir(original);if(previous===undefined)delete process.env.ADMIN_PASSWORD;else process.env.ADMIN_PASSWORD=previous;await rm(dir,{recursive:true,force:true});}
});
