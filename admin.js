import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openStorage } from './storage.js';
import {digest,verifyPassword as verifyPortablePassword} from './cloudflare/security.js';
import {checkRecoveryToken,validNewPassword,makePasswordHash} from './admin-recovery.js';
export { categories, validatePost } from './post-validation.js';
import { validatePost } from './post-validation.js';
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
 return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function verifyPassword(password, credential) {
 if (typeof password !== 'string' || password.length > 1024) return false;
 const actual = scryptSync(password, credential.salt, 64); const expected = Buffer.from(credential.hash, 'hex');
 return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function installAdmin(app, storage) {
 if (!storage) { storage = openStorage(); storage.initialize(); }
 let credential = null;
 if (process.env.ADMIN_PASSWORD?.length >= 12) credential = passwordHash(process.env.ADMIN_PASSWORD);
 else { try { credential = JSON.parse(await readFile('data/admin-credential.json', 'utf8')); } catch {} }
 // Stable, slow-derived version for an environment password; never store its fast digest.
 const baseVersion=await digest(JSON.stringify(process.env.ADMIN_PASSWORD?.length>=12?passwordHash(process.env.ADMIN_PASSWORD,'nounarchive-credential-version'):credential));
 const override=()=>{const row=storage.getAdminCredential();return row?.base_version===baseVersion?row.password_hash:null;};
 const credentialVersion=async()=>digest(override()||baseVersion);
 let posts = storage.loadPosts();
 const sessions = new Map(), attempts = new Map();
 const lifetime = 8 * 60 * 60 * 1000;
 setInterval(() => { const now=Date.now(); for(const [k,v] of sessions) if(v.expires<now) sessions.delete(k); for(const [k,v] of attempts) if(v.until<now) attempts.delete(k); }, 60000).unref();
 const persist = async next => { storage.savePosts(next); posts=next; };
 let queue=Promise.resolve();
 function mutate(fn) { const operation=queue.then(()=>fn()); queue=operation.catch(()=>{}); return operation; }
 app.use('/api/admin', (req,res,next)=>{res.set('Cache-Control','no-store'); next();});
 app.post('/api/admin/password-reset',async(req,res)=>{
 if(req.get('X-Nounarchive-Admin')!=='1')return res.status(403).json({error:'Invalid request.'});
 const key='reset:'+req.socket.remoteAddress,now=Date.now();let attempt=attempts.get(key);
 if(!attempt||attempt.until<now)attempt={count:0,until:now+900000};
 if(attempt.count>=5)return res.status(429).json({error:'Too many recovery attempts. Try again in 15 minutes.'});
 attempt.count++;attempts.set(key,attempt);
 const recovery=await checkRecoveryToken(req.body?.token,process.env.ADMIN_RESET_TOKEN_HASH);
 if(!recovery)return res.status(400).json({error:'Recovery token is invalid, expired, or already used. Ask the site owner for a fresh token.'});
 if(!validNewPassword(req.body?.newPassword))return res.status(400).json({error:'Use a password between 12 and 1024 characters.'});
 const hash=await makePasswordHash(req.body.newPassword);
 if(recovery.expires<=Date.now())return res.status(400).json({error:'Recovery token expired. Ask the site owner for a fresh token.'});
 if(!storage.applyAdminReset(hash,baseVersion,recovery.hash,recovery.expires))return res.status(400).json({error:'Recovery token is invalid, expired, or already used. Ask the site owner for a fresh token.'});
 sessions.clear();attempts.delete(req.socket.remoteAddress);
 res.clearCookie('nounarchive_admin',{path:'/api/admin'});return res.json({ok:true});
 });
 app.post('/api/admin/login', async(req,res)=>{
 const activeHash=override();
 if(!credential&&!activeHash) return res.status(503).json({error:'Admin access is not configured. Run npm run admin:setup on the server or set ADMIN_PASSWORD (at least 12 characters), then restart.'});
 if(req.get('X-Nounarchive-Admin')!=='1') return res.status(403).json({error:'Invalid request.'});
 const ip=req.socket.remoteAddress, now=Date.now(); let attempt=attempts.get(ip);
 if(!attempt || attempt.until<now) attempt={count:0,until:now+15*60*1000};
 if(attempt.count>=5) return res.status(429).json({error:'Too many login attempts. Try again in 15 minutes.'});
 attempt.count++; attempts.set(ip,attempt);
 if(!(activeHash?await verifyPortablePassword(req.body?.password,activeHash):verifyPassword(req.body?.password,credential))) return res.status(401).json({error:'Incorrect password.'});
 attempts.delete(ip); const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
 sessions.set(token,{csrf,expires:now+lifetime,version:await digest(activeHash||baseVersion)});
 const secure=req.secure || req.get('x-forwarded-proto')==='https';
 res.cookie('nounarchive_admin',token,{httpOnly:true,sameSite:'strict',secure,maxAge:lifetime,path:'/api/admin'});
 res.json({csrf});
 });
 app.use('/api/admin',async(req,res,next)=>{
 const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('nounarchive_admin='))?.split('=')[1];
 const session=sessions.get(token);
 if(!session || session.expires<Date.now() || session.version!==await credentialVersion()) return res.status(401).json({error:'Please sign in to continue.'});
 if(req.method!=='GET' && (req.get('X-CSRF-Token')!==session.csrf || req.get('X-Nounarchive-Admin')!=='1')) return res.status(403).json({error:'Invalid session request. Refresh and sign in again.'});
 req.adminToken=token; req.adminSession=session; next();
 });
 app.get('/api/admin/session',(req,res)=>res.json({csrf:req.adminSession.csrf}));
 app.post('/api/admin/logout',(req,res)=>{sessions.delete(req.adminToken);res.clearCookie('nounarchive_admin',{path:'/api/admin'});res.json({ok:true});});
 app.get('/api/admin/posts',(req,res)=>res.json(posts));
 app.post('/api/admin/posts',async(req,res)=>{
 let fields; try { fields=validatePost(req.body||{}); } catch(e){return res.status(400).json({error:e.message});}
 const now=new Date().toISOString(); const post={...fields,id:randomBytes(12).toString('hex'),createdAt:now,updatedAt:now,publishedAt:fields.status==='published'?now:null};
 await mutate(async()=>persist([post,...posts]));res.status(201).json(post);
 });
 app.put('/api/admin/posts/:id',async(req,res)=>{
 let fields;try{fields=validatePost(req.body||{});}catch(e){return res.status(400).json({error:e.message});}
 await mutate(async()=>{
 const existing=posts.find(p=>p.id===req.params.id); if(!existing){res.status(404).json({error:'Post not found.'});return;}
 const post={...existing,...fields,updatedAt:new Date().toISOString(),publishedAt:existing.publishedAt || (fields.status==='published'?new Date().toISOString():null)};
 await persist(posts.map(p=>p.id===post.id?post:p));res.json(post);
 });
 });
 app.delete('/api/admin/posts/:id',async(req,res)=>{await mutate(async()=>{
 if(!posts.some(p=>p.id===req.params.id)) return res.status(404).json({error:'Post not found.'});
 await persist(posts.filter(p=>p.id!==req.params.id));res.json({ok:true});
 });});
 app.get('/api/posts/:id',(req,res)=>{
 const post=posts.find(p=>p.id===req.params.id && p.status==='published');
 if(!post)return res.status(404).json({error:'This post is unavailable.'});res.set('Cache-Control','no-store').json(post);
 });
 return { published:()=>posts.filter(p=>p.status==='published').map(p=>({id:p.id,title:p.title,excerpt:p.excerpt,category:p.category,publishedAt:p.publishedAt,readingMinutes:Math.max(1,Math.ceil(p.content.split(/\s+/).length/200)),source:'nounarchive',url:'/post.html?id='+p.id})) };
}
