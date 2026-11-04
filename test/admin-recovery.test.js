import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {openStorage} from '../storage.js';
import {installAdmin} from '../admin.js';
import {digest,randomToken,verifyPassword} from '../cloudflare/security.js';
import {checkRecoveryToken,makePasswordHash,validNewPassword} from '../admin-recovery.js';

test('recovery tokens require a private digest, valid expiry and strong password bounds',async()=>{
 const token=randomToken(),now=Date.now(),config=`${now+900000}$${await digest(token)}`;
 assert.ok(await checkRecoveryToken(token,config,now));
 for(const [value,setting] of [[randomToken(),config],[token,`${now-1}$${await digest(token)}`],[token,''],[{},config]])assert.equal(await checkRecoveryToken(value,setting,now),null);
 assert.equal(validNewPassword('a'.repeat(11)),false);assert.equal(validNewPassword('a'.repeat(12)),true);assert.equal(validNewPassword('a'.repeat(1025)),false);assert.equal(validNewPassword(null),false);
 const hash=await makePasswordHash('a long new test password');assert.equal(await verifyPassword('a long new test password',hash),true);
});

test('Node owner recovery is single-use, persists, revokes sessions and rate limits guessing',async()=>{
 const previous={password:process.env.ADMIN_PASSWORD,reset:process.env.ADMIN_RESET_TOKEN_HASH};
 const token=randomToken(),newPassword='my-new-recovery-password';
 process.env.ADMIN_PASSWORD='original-test-password';process.env.ADMIN_RESET_TOKEN_HASH=`${Date.now()+900000}$${await digest(token)}`;
 const store=openStorage(':memory:');store.initialize();const servers=[];
 async function start(){const app=express();app.use(express.json());await installAdmin(app,store);const server=app.listen(0,'127.0.0.1');servers.push(server);await new Promise(r=>server.once('listening',r));return `http://127.0.0.1:${server.address().port}/api/admin`;}
 try{
 const base=await start();const request=(path,body,headers={})=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const login=await request('/login',{password:'original-test-password'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/password-reset',{token,newPassword},{'X-Nounarchive-Admin':'0'})).status,403);
 assert.equal((await request('/password-reset',{token:randomToken(),newPassword})).status,400);
 assert.equal((await request('/password-reset',{token,newPassword:'short'})).status,400);
 const results=await Promise.all([request('/password-reset',{token,newPassword}),request('/password-reset',{token,newPassword})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
 assert.equal((await request('/session',null,{Cookie:cookie})).status,401);
 assert.equal((await request('/login',{password:'original-test-password'})).status,401);
 const newLogin=await request('/login',{password:newPassword});assert.equal(newLogin.status,200);const newCookie=newLogin.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/password-reset',{token,newPassword:'another-test-password'})).status,400);
 assert.equal((await request('/session',null,{Cookie:newCookie})).status,200);
 assert.equal((await request('/password-reset',{token,newPassword})).status,429);
 const reloaded=await start();assert.equal((await fetch(reloaded+'/login',{method:'POST',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1'},body:JSON.stringify({password:newPassword})})).status,200);
 process.env.ADMIN_PASSWORD='operator-rotated-password';const rotated=await start();
 assert.equal((await fetch(rotated+'/login',{method:'POST',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1'},body:JSON.stringify({password:'operator-rotated-password'})})).status,200);
 assert.equal((await fetch(rotated+'/login',{method:'POST',headers:{'Content-Type':'application/json','X-Nounarchive-Admin':'1'},body:JSON.stringify({password:newPassword})})).status,401);
 }finally{
 for(const server of servers)await new Promise(r=>server.close(r));store.close();
 for(const [key,value] of [['ADMIN_PASSWORD',previous.password],['ADMIN_RESET_TOKEN_HASH',previous.reset]])if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
