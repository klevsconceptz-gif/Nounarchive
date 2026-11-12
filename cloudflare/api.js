import {Hono} from 'hono';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import {bodyLimit} from 'hono/body-limit';
import {validatePost} from '../post-validation.js';
import {sources,resourceSources,collect,collectResources} from '../aggregator.js';
import {mergeArticle} from '../news-sync.js';
import seed from '../data/seed.json';
import resourceSeed from '../public/resources.json';
import {digest,randomToken,verifyPassword} from './security.js';
import {HASH_PATTERN,CLAIM_RESET_SQL,SAVE_RESET_SQL,checkRecoveryToken,validNewPassword,makePasswordHash} from '../admin-recovery.js';
export const api=new Hono();
const publicSource={id:'nounarchive',name:'Nounarchive',url:'/'};
const statement=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
const NEWS_KV_PREFIX='nounarchive:news:v1:';
const RESOURCE_KV_PREFIX='nounarchive:resources:v1:';
const KV_MAX_VALUE_BYTES=25*1024*1024;
async function activeCredential(env){
 const baseVersion=await digest(env.ADMIN_PASSWORD_HASH||'');
 const saved=await statement(env,'SELECT * FROM admin_credentials WHERE id=1').first();
 return {baseVersion,hash:saved?.base_version===baseVersion?saved.password_hash:env.ADMIN_PASSWORD_HASH};
}
const records=async(env,sql,...values)=>(await statement(env,sql,...values).all()).results;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
async function optionalRecords(env,label,sql,...values){
 if(!env.DB)return [];
 try{return await records(env,sql,...values);}
 catch(error){console.warn(`D1 ${label} read failed; using KV/snapshot fallback:`,error?.message||String(error));return [];}
}
async function optionalFirst(env,label,sql,...values){
 if(!env.DB)return null;
 try{return await statement(env,sql,...values).first();}
 catch(error){console.warn(`D1 ${label} read failed; using KV/snapshot fallback:`,error?.message||String(error));return null;}
}
async function readKvDocument(env,key){
 if(!env.kv)return null;
 try{
  const value=await env.kv.get(key);
  if(value===null)return null;
  const document=JSON.parse(value);
  if(!isObject(document)||document.version!==1||!Array.isArray(document.items))throw new Error('Stored archive document is invalid.');
  return document;
 }catch(error){console.warn(`KV read failed for ${key}:`,error?.message||String(error));return null;}
}
async function writeKvDocument(env,key,document){
 if(!env.kv)return false;
 try{
  const value=JSON.stringify(document);
  if(new TextEncoder().encode(value).byteLength>KV_MAX_VALUE_BYTES)throw new Error('Archive exceeds the 25 MiB KV value limit.');
  await env.kv.put(key,value);
  return true;
 }catch(error){console.error(`KV write failed for ${key}:`,error?.message||String(error));return false;}
}
function recordData(row,label){
 try{return JSON.parse(row.data);}
 catch(error){console.warn(`Skipping invalid ${label} record:`,error?.message||String(error));return null;}
}
const postSummary=p=>({id:p.id,title:p.title,excerpt:p.excerpt,category:p.category,publishedAt:p.publishedAt,readingMinutes:Math.max(1,Math.ceil(p.content.split(/\s+/).length/200)),source:'nounarchive',url:'/post.html?id='+p.id});
api.use('*',async(c,next)=>{
 c.header('Cache-Control','no-store');c.header('X-Content-Type-Options','nosniff');c.header('Referrer-Policy','strict-origin-when-cross-origin');
 if(!c.env.DB&&!['/api/archive','/api/resources'].includes(c.req.path))return c.json({error:'D1 database binding is not configured.'},503);
 await next();
});
api.use('*',bodyLimit({maxSize:100*1024,onError:c=>c.json({error:'Request too large.'},413)}));
const requiredD1Tables=['articles','source_status','posts','admin_sessions','login_attempts','admin_credentials','admin_reset_tokens','resources','resource_status'];
api.get('/api/health',async c=>{
 try{
  const {results=[]}=await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tables=new Set(results.map(row=>row.name));
  if(requiredD1Tables.some(name=>!tables.has(name)))return c.json({ok:false,database:'d1',error:'Database schema is not ready.'},503);
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ok:true,database:'d1'});
 }catch{
  return c.json({ok:false,database:'d1',error:'Database is not ready.'},503);
 }
});
api.get('/api/archive',async c=>{
 const [articleRows,postRows,statusRows,kvDocuments]=await Promise.all([
  optionalRecords(c.env,'archive articles','SELECT data FROM articles ORDER BY published_at DESC'),
  optionalRecords(c.env,'published posts',"SELECT data FROM posts WHERE status='published' ORDER BY published_at DESC"),
  optionalRecords(c.env,'source status','SELECT source,data FROM source_status'),
  Promise.all(sources.map(source=>readKvDocument(c.env,NEWS_KV_PREFIX+source.id)))
 ]);
 const merged=new Map(seed.items.map(item=>[item.id,item]));
 for(const row of articleRows){const item=recordData(row,'news');if(item?.id)merged.set(item.id,item);}
 const status={...seed.status};
 for(const row of statusRows){const value=recordData(row,'source status');if(value&&row.source)status[row.source]=value;}
 for(let index=0;index<sources.length;index++){
  const source=sources[index],document=kvDocuments[index];
  if(!document)continue;
  for(const item of document.items)if(item?.source===source.id&&typeof item.id==='string')merged.set(item.id,item);
  if(isObject(document.status))status[source.id]=document.status;
 }
 const posts=[];
 for(const row of postRows){const post=recordData(row,'published post');if(!post||typeof post.content!=='string')continue;try{posts.push(postSummary(post));}catch(error){console.warn('Skipping invalid published post:',error?.message||String(error));}}
 return c.json({snapshotAt:seed.snapshotAt,items:[...merged.values(),...posts],status,sources:[...sources,publicSource],syncing:false,refreshMinutes:1440});
});
function mergeResourceItems(...collections){
 const byId=new Map(),byUrl=new Map();
 for(const collection of collections)for(const item of collection){
  if(!item||typeof item.id!=='string')continue;
  const key=canonicalResourceUrl(item.url),existing=byId.get(item.id)||(key&&byUrl.get(key));
  const merged=existing?{...existing,...item,id:existing.id}:item;
  byId.set(merged.id,merged);
  const mergedKey=canonicalResourceUrl(merged.url);if(mergedKey)byUrl.set(mergedKey,merged);
 }
 return [...byId.values()];
}
api.get('/api/resources',async c=>{
 const [stored,statusRows,kvDocuments]=await Promise.all([
  optionalRecords(c.env,'resources','SELECT data FROM resources ORDER BY updated_at DESC'),
  optionalRecords(c.env,'resource status','SELECT source,data FROM resource_status'),
  Promise.all(resourceSources.map(source=>readKvDocument(c.env,RESOURCE_KV_PREFIX+source.id)))
 ]);
 const storedItems=stored.map(row=>recordData(row,'resource')).filter(Boolean);
 const kvItems=kvDocuments.flatMap((document,index)=>document?document.items.filter(item=>item?.source===resourceSources[index].name):[]);
 const status={};
 for(const row of statusRows){const value=recordData(row,'resource status');if(value&&row.source)status[row.source]=value;}
 for(let index=0;index<resourceSources.length;index++)if(isObject(kvDocuments[index]?.status))status[resourceSources[index].id]=kvDocuments[index].status;
 const items=mergeResourceItems(resourceSeed,storedItems,kvItems);
 const lastSuccess=Object.values(status).filter(result=>result?.state==='ok'&&result.lastSuccess).map(result=>result.lastSuccess).sort().at(-1)||null;
 return c.json({items,status,lastSuccess,refreshMinutes:1440});
});
api.get('/api/posts/:id',async c=>{
 const row=await statement(c.env,"SELECT data FROM posts WHERE id=? AND status='published'",c.req.param('id')).first();return row?c.json(JSON.parse(row.data)):c.json({error:'This post is unavailable.'},404);
});
api.post('/api/admin/password-reset',async c=>{
 if(c.req.header('X-Nounarchive-Admin')!=='1')return c.json({error:'Invalid request.'},403);
 const now=Date.now(),ip=await digest('reset:'+(c.req.header('CF-Connecting-IP')||'local'));
 const attempt=await statement(c.env,`INSERT INTO login_attempts(ip_hash,attempts,expires) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING attempts`,ip,now+900000,now,now,now+900000).first();
 if(attempt.attempts>5)return c.json({error:'Too many recovery attempts. Try again in 15 minutes.'},429);
 const body=await c.req.json().catch(()=>null),recovery=await checkRecoveryToken(body?.token,c.env.ADMIN_RESET_TOKEN_HASH);
 if(!recovery)return c.json({error:'Recovery token is invalid, expired, or already used. Ask the site owner for a fresh token.'},400);
 if(!validNewPassword(body?.newPassword))return c.json({error:'Use a password between 12 and 1024 characters.'},400);
 const hash=await makePasswordHash(body.newPassword),baseVersion=await digest(c.env.ADMIN_PASSWORD_HASH||'');
 if(recovery.expires<=Date.now())return c.json({error:'Recovery token expired. Ask the site owner for a fresh token.'},400);
 const results=await c.env.DB.batch([
 statement(c.env,CLAIM_RESET_SQL,recovery.hash,recovery.expires),statement(c.env,SAVE_RESET_SQL,hash,baseVersion),
 statement(c.env,'DELETE FROM admin_sessions WHERE EXISTS (SELECT 1 FROM admin_credentials WHERE password_hash=?)',hash)
 ]);
 if(!results[0].meta.changes)return c.json({error:'Recovery token is invalid, expired, or already used. Ask the site owner for a fresh token.'},400);
 await statement(c.env,'DELETE FROM login_attempts WHERE ip_hash=?',await digest('reset:'+(c.req.header('CF-Connecting-IP')||'local'))).run();
 deleteCookie(c,'nounarchive_admin',{path:'/api/admin'});return c.json({ok:true});
});
api.post('/api/admin/login',async c=>{
 const credential=await activeCredential(c.env);
 if(!HASH_PATTERN.test(credential.hash||''))return c.json({error:'Admin is not configured. Set the ADMIN_PASSWORD_HASH Worker/Pages secret using npm run cf:admin-hash.'},503);
 if(c.req.header('X-Nounarchive-Admin')!=='1')return c.json({error:'Invalid request.'},403);
 const now=Date.now(),ip=await digest(c.req.header('CF-Connecting-IP')||'local');
 const attempt=await statement(c.env,`INSERT INTO login_attempts(ip_hash,attempts,expires) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN expires<? THEN 1 ELSE attempts+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING attempts`,ip,now+900000,now,now,now+900000).first();
 if(attempt.attempts>5)return c.json({error:'Too many login attempts. Try again in 15 minutes.'},429);
 const body=await c.req.json();if(!await verifyPassword(body.password,credential.hash))return c.json({error:'Incorrect password.'},401);
 const token=randomToken(),csrf=randomToken(),hash=await digest(token),version=await digest(credential.hash);
 await c.env.DB.batch([statement(c.env,'DELETE FROM login_attempts WHERE ip_hash=?',ip),statement(c.env,'INSERT INTO admin_sessions(token_hash,csrf,credential_version,expires) VALUES(?,?,?,?)',hash,csrf,version,now+28800000)]);
 setCookie(c,'nounarchive_admin',token,{httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/api/admin',maxAge:28800});return c.json({csrf});
});
api.use('/api/admin/*',async(c,next)=>{
 const token=getCookie(c,'nounarchive_admin');if(!token)return c.json({error:'Please sign in to continue.'},401);
 const tokenHash=await digest(token),session=await statement(c.env,'SELECT * FROM admin_sessions WHERE token_hash=? AND expires>?',tokenHash,Date.now()).first();
 if(!session||session.credential_version!==await digest((await activeCredential(c.env)).hash||''))return c.json({error:'Please sign in to continue.'},401);
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
async function writeD1Batch(env,writes,label){
 if(!env.DB||!writes.length)return;
 try{for(let index=0;index<writes.length;index+=50)await env.DB.batch(writes.slice(index,index+50));}
 catch(error){console.warn(`D1 ${label} write failed; KV remains the public archive:`,error?.message||String(error));}
}
async function writeD1Status(env,table,sourceId,status,label){
 if(!env.DB)return;
 try{await statement(env,`INSERT INTO ${table}(source,data) VALUES(?,?) ON CONFLICT(source) DO UPDATE SET data=excluded.data`,sourceId,JSON.stringify(status)).run();}
 catch(error){console.warn(`D1 ${label} status write failed; KV remains the public archive:`,error?.message||String(error));}
}
async function syncNewsSource(env,source){
 const checkedAt=new Date().toISOString(),key=NEWS_KV_PREFIX+source.id;
 const [document,existingRows,oldStatusRow]=await Promise.all([
  readKvDocument(env,key),
  optionalRecords(env,`${source.name} news`,'SELECT data FROM articles WHERE source=?',source.id),
  optionalFirst(env,`${source.name} news status`,'SELECT data FROM source_status WHERE source=?',source.id)
 ]);
 const items=new Map(seed.items.filter(item=>item.source===source.id).map(item=>[item.id,item]));
 for(const row of existingRows){const item=recordData(row,'news');if(item?.id&&item.source===source.id)items.set(item.id,item);}
 for(const item of document?.items||[])if(item?.id&&item.source===source.id)items.set(item.id,item);
 const oldStatus=oldStatusRow?recordData(oldStatusRow,`${source.name} news status`):null;
 const previousStatus={...(seed.status[source.id]||{}),...(oldStatus||{}),...(isObject(document?.status)?document.status:{})};
 const savedIncoming=[];let status;
 try{
  const incoming=await collect(source);
  if(!incoming.length)throw new Error('No articles found.');
  for(const article of incoming){
   const saved=mergeArticle(items.get(article.id),article,checkedAt);
   items.set(saved.id,saved);savedIncoming.push(saved);
  }
  status={state:'ok',checkedAt,lastSuccess:checkedAt,message:`${incoming.length} articles found`};
 }catch(error){status={...previousStatus,state:'error',checkedAt,message:String(error?.message||'News refresh failed').slice(0,180)};}
 await writeKvDocument(env,key,{version:1,updatedAt:checkedAt,items:[...items.values()],status});
 const writes=env.DB?savedIncoming.map(article=>statement(env,'INSERT INTO articles(id,source,published_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,published_at=excluded.published_at,data=excluded.data',article.id,article.source,article.publishedAt,JSON.stringify(article))):[];
 await writeD1Batch(env,writes,`${source.name} news`);
 await writeD1Status(env,'source_status',source.id,status,source.name+' news');
}

function canonicalResourceUrl(value){
 try{const url=new URL(value);url.hash='';if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/,'');return url.href.toLowerCase();}catch{return '';}
}
async function syncResourceSource(env,source){
 const checkedAt=new Date().toISOString(),key=RESOURCE_KV_PREFIX+source.id;
 const [document,existingRows,oldStatusRow]=await Promise.all([
  readKvDocument(env,key),
  optionalRecords(env,`${source.name} resources`,'SELECT data FROM resources WHERE source=?',source.name),
  optionalFirst(env,`${source.name} resource status`,'SELECT data FROM resource_status WHERE source=?',source.id)
 ]);
 const existingItems=existingRows.map(row=>recordData(row,'resource')).filter(item=>item?.source===source.name);
 const documentItems=(document?.items||[]).filter(item=>item?.source===source.name);
 const byId=new Map(mergeResourceItems(resourceSeed.filter(item=>item.source===source.name),existingItems,documentItems).map(item=>[item.id,item]));
 const byUrl=new Map([...byId.values()].map(item=>[canonicalResourceUrl(item.url),item]));
 const oldStatus=oldStatusRow?recordData(oldStatusRow,`${source.name} resource status`):null;
 const previousStatus={...(oldStatus||{}),...(isObject(document?.status)?document.status:{})};
 const savedIncoming=[];let status;
 try{
  const incoming=await collectResources(source);
  if(!incoming.length)throw new Error('No resource listings found.');
  for(const entry of incoming){
   const old=byId.get(entry.id)||byUrl.get(canonicalResourceUrl(entry.url));
   const saved={...old,...entry,id:old?.id||entry.id,firstSeenAt:old?.firstSeenAt||checkedAt,lastSeenAt:checkedAt};
   byId.set(saved.id,saved);byUrl.set(canonicalResourceUrl(saved.url),saved);savedIncoming.push(saved);
  }
  status={state:'ok',checkedAt,lastSuccess:checkedAt,message:`${incoming.length} resources found`};
 }catch(error){status={...previousStatus,state:'error',checkedAt,message:String(error?.message||'Resource refresh failed').slice(0,180)};}
 await writeKvDocument(env,key,{version:1,updatedAt:checkedAt,items:[...byId.values()],status});
 const writes=env.DB?savedIncoming.map(item=>statement(env,'INSERT INTO resources(id,source,updated_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,updated_at=excluded.updated_at,data=excluded.data',item.id,source.name,checkedAt,JSON.stringify(item))):[];
 await writeD1Batch(env,writes,`${source.name} resources`);
 await writeD1Status(env,'resource_status',source.id,status,source.name+' resources');
}

export async function syncSources(env){
 // Fetch independent providers together so the daily run finishes reliably while
 // every write remains scoped to its own source and existing records are kept.
 await Promise.all([
  ...sources.map(source=>syncNewsSource(env,source)),
  ...resourceSources.map(source=>syncResourceSource(env,source))
 ]);
 if(env.DB)try{
  await env.DB.batch([
   statement(env,'DELETE FROM admin_sessions WHERE expires<?',Date.now()),
   statement(env,'DELETE FROM login_attempts WHERE expires<?',Date.now())
  ]);
 }catch(error){console.warn('D1 session cleanup failed after the KV refresh:',error?.message||String(error));}
}
