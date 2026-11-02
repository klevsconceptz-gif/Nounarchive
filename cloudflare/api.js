import {Hono} from 'hono';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import {bodyLimit} from 'hono/body-limit';
import {validatePost} from '../post-validation.js';
import {sources,collect} from '../aggregator.js';
import seed from '../data/seed.json';
import {digest,randomToken,verifyPassword} from './security.js';
export const api=new Hono();
const publicSource={id:'nounarchive',name:'Nounarchive',url:'/'};
const statement=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
const records=async(env,sql,...values)=>(await statement(env,sql,...values).all()).results;
const postSummary=p=>({id:p.id,title:p.title,excerpt:p.excerpt,category:p.category,publishedAt:p.publishedAt,readingMinutes:Math.max(1,Math.ceil(p.content.split(/\s+/).length/200)),source:'nounarchive',url:'/post.html?id='+p.id});
api.use('*',async(c,next)=>{
 c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');
 if(!c.env.DB)return c.json({error:'D1 database binding is not configured.'},503);
 await next();
});
api.use('*',bodyLimit({maxSize:100*1024,onError:c=>c.json({error:'Request too large.'},413)}));
api.get('/api/health',async c=>{await c.env.DB.prepare('SELECT 1').first();return c.json({ok:true,database:'d1'});});
api.get('/api/archive',async c=>{
 const [articles,posts,statuses]=await Promise.all([records(c.env,'SELECT data FROM articles ORDER BY published_at DESC'),records(c.env,"SELECT data FROM posts WHERE status='published' ORDER BY published_at DESC"),records(c.env,'SELECT source,data FROM source_status')]);
 // Snapshot is a fallback, not written implicitly into a live database.
 const merged=new Map(seed.items.map(i=>[i.id,i]));articles.forEach(r=>{const i=JSON.parse(r.data);merged.set(i.id,i);});
 return c.json({snapshotAt:seed.snapshotAt,items:[...merged.values(),...posts.map(r=>postSummary(JSON.parse(r.data)))],status:{...seed.status,...Object.fromEntries(statuses.map(r=>[r.source,JSON.parse(r.data)]))},sources:[...sources,publicSource],syncing:false,refreshMinutes:60});
});
api.get('/api/posts/:id',async c=>{
 const row=await statement(c.env,"SELECT data FROM posts WHERE id=? AND status='published'",c.req.param('id')).first();return row?c.json(JSON.parse(row.data)):c.json({error:'This post is unavailable.'},404);
});
api.post('/api/admin/login',async c=>{
 if(!/^pbkdf2-sha256\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/.test(c.env.ADMIN_PASSWORD_HASH||''))return c.json({error:'Admin is not configured. Set the ADMIN_PASSWORD_HASH Worker/Pages secret using npm run cf:admin-hash.'},503);
 if(c.req.header('X-Nounarchive-Admin')!=='1')return c.json({error:'Invalid request.'},403);
 const now=Date.now(),ip=await digest(c.req.header('CF-Connecting-IP')||'local');
 const attempt=await statement(c.env,`INSERT INTO login_attempts(ip_hash,attempts,expires) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING attempts`,ip,now+900000,now,now,now+900000).first();
 if(attempt.attempts>5)return c.json({error:'Too many login attempts. Try again in 15 minutes.'},429);
 const body=await c.req.json();if(!await verifyPassword(body.password,c.env.ADMIN_PASSWORD_HASH))return c.json({error:'Incorrect password.'},401);
 const token=randomToken(),csrf=randomToken(),hash=await digest(token),version=await digest(c.env.ADMIN_PASSWORD_HASH);
 await c.env.DB.batch([statement(c.env,'DELETE FROM login_attempts WHERE ip_hash=?',ip),statement(c.env,'INSERT INTO admin_sessions(token_hash,csrf,credential_version,expires) VALUES(?,?,?,?)',hash,csrf,version,now+28800000)]);
 setCookie(c,'nounarchive_admin',token,{httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/api/admin',maxAge:28800});return c.json({csrf});
});
api.use('/api/admin/*',async(c,next)=>{
 const token=getCookie(c,'nounarchive_admin');if(!token||!c.env.ADMIN_PASSWORD_HASH)return c.json({error:'Please sign in to continue.'},401);
 const tokenHash=await digest(token),session=await statement(c.env,'SELECT * FROM admin_sessions WHERE token_hash=? AND expires>?',tokenHash,Date.now()).first();
 if(!session||session.credential_version!==await digest(c.env.ADMIN_PASSWORD_HASH))return c.json({error:'Please sign in to continue.'},401);
 if(c.req.method!=='GET'&&(c.req.header('X-CSRF-Token')!==session.csrf||c.req.header('X-Nounarchive-Admin')!=='1'))return c.json({error:'Invalid session request. Refresh and sign in again.'},403);
 c.set('session',session);c.set('tokenHash',tokenHash);await next();
});
api.get('/api/admin/session',c=>c.json({csrf:c.get('session').csrf}));
api.post('/api/admin/logout',async c=>{await statement(c.env,'DELETE FROM admin_sessions WHERE token_hash=?',c.get('tokenHash')).run();deleteCookie(c,'nounarchive_admin',{path:'/api/admin'});return c.json({ok:true});});
api.get('/api/admin/posts',async c=>c.json((await records(c.env,'SELECT data FROM posts ORDER BY updated_at DESC')).map(r=>JSON.parse(r.data))));
async function savePost(c,editing){
 let fields;try{fields=validatePost(await c.req.json());}catch(e){return c.json({error:e.message},400);}
 const id=editing?c.req.param('id'):randomToken().slice(0,24);
 const row=editing?await statement(c.env,'SELECT data FROM posts WHERE id=?',id).first():null;
 if(editing&&!row)return c.json({error:'Post not found.'},404);
 const old=row?JSON.parse(row.data):{},now=new Date().toISOString();
 const post={...old,...fields,id,createdAt:old.createdAt||now,updatedAt:now,publishedAt:old.publishedAt||(fields.status==='published'?now:null)};
 // Update a single row: never replace all posts or recreate a concurrently deleted post.
 const result=editing?await statement(c.env,'UPDATE posts SET status=?,published_at=?,updated_at=?,data=? WHERE id=?',post.status,post.publishedAt,now,JSON.stringify(post),id).run():await statement(c.env,'INSERT INTO posts(id,status,published_at,updated_at,data) VALUES(?,?,?,?,?)',id,post.status,post.publishedAt,now,JSON.stringify(post)).run();
 if(editing&&!result.meta.changes)return c.json({error:'Post no longer exists.'},404);
 return c.json(post,editing?200:201);
}
api.post('/api/admin/posts',c=>savePost(c,false));api.put('/api/admin/posts/:id',c=>savePost(c,true));
api.delete('/api/admin/posts/:id',async c=>{const result=await statement(c.env,'DELETE FROM posts WHERE id=?',c.req.param('id')).run();return result.meta.changes?c.json({ok:true}):c.json({error:'Post not found.'},404);});
api.notFound(c=>c.json({error:'Not found.'},404));
api.onError((error,c)=>{console.error(error.message);return c.json({error:'Unable to complete this request. Check configuration and D1 migrations.'},500);});
export async function syncSources(env){
 // Sequential requests keep CPU/memory predictable on edge runtimes.
 for(const source of sources){
 const checkedAt=new Date().toISOString();let status;
 try{
 const items=await collect(source);
 const writes=items.map(item=>statement(env,'INSERT INTO articles(id,source,published_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,published_at=excluded.published_at,data=excluded.data',item.id,item.source,item.publishedAt,JSON.stringify({...item,verifiedAt:checkedAt})));
 for(let i=0;i<writes.length;i+=50)await env.DB.batch(writes.slice(i,i+50));
 status={state:'ok',checkedAt,lastSuccess:checkedAt,message:`${items.length} articles found`};
 }catch(error){const old=await statement(env,'SELECT data FROM source_status WHERE source=?',source.id).first();status={...(old?JSON.parse(old.data):{}),state:'error',checkedAt,message:error.message};}
 await statement(env,'INSERT INTO source_status(source,data) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET data=excluded.data',source.id,JSON.stringify(status)).run();
 }
 await env.DB.batch([statement(env,'DELETE FROM admin_sessions WHERE expires<?',Date.now()),statement(env,'DELETE FROM login_attempts WHERE expires<?',Date.now())]);
}
