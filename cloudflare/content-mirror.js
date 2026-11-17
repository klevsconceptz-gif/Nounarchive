import {createHash} from 'node:crypto';
import * as cheerio from 'cheerio';
import {XMLParser} from 'fast-xml-parser';
import {sources} from '../aggregator.js';

const PAGE_LIMIT=30;
const SITEMAP_LIMIT=8;
const ASSET_LIMIT=8;
const HTML_LIMIT=3_000_000;
const SITEMAP_BYTE_LIMIT=6_000_000;
const FILE_LIMIT=100_000_000;
const UNKNOWN_LENGTH_FILE_LIMIT=20_000_000;
const TEXT_LIMIT=120_000;
const MAX_LINKS_PER_PAGE=250;
const DAY_MS=24*60*60*1000;
const USER_AGENT='Nounarchive/1.0 (+local educational archive)';
const SAFE_FILE_EXTENSIONS=new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','zip','rar','7z','epub','rtf','odt','ods','csv','txt']);
const CONTENT_TYPES={
 pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 zip:'application/zip',rar:'application/vnd.rar','7z':'application/x-7z-compressed',epub:'application/epub+zip',
 rtf:'application/rtf',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',csv:'text/csv',txt:'text/plain'
};
const SAFE_CONTENT_TYPES=new Set(Object.values(CONTENT_TYPES).concat(['application/x-zip-compressed','application/octet-stream']));
const parser=new XMLParser({ignoreAttributes:false,trimValues:true,processEntities:false});
const statement=(env,sql,...values)=>env.DB.prepare(sql).bind(...values);
const records=async(env,sql,...values)=>(await statement(env,sql,...values).all()).results;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>cheerio.load(String(value||'')).text().replace(/\s+/g,' ').trim();

function hostsFor(source){
 const host=new URL(source.url).hostname.toLowerCase();
 return new Set([host,host.startsWith('www.')?host.slice(4):`www.${host}`]);
}
function blockedPath(path){
 return /(?:^|\/)(?:wp-admin|wp-login\.php|xmlrpc\.php|login|logout|register|signup|account|dashboard|student-portal|portal|results?(?:[-_]?(?:checker|lookup|portal))?|check[-_]result|checker)(?:\.php)?(?:\/|$)/i.test(path);
}
function removeTracking(url){
 for(const key of [...url.searchParams.keys()])if(/^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(key))url.searchParams.delete(key);
}
export function normalizeMirrorUrl(source,value,base=source.url,{asset=false}={}){
 let url;try{url=new URL(value,base);}catch{return null;}
 if(url.protocol!=='https:'||!hostsFor(source).has(url.hostname.toLowerCase())||url.username||url.password||url.port&&url.port!=='443'||blockedPath(url.pathname))return null;
 url.port='';url.hash='';
 if(!asset){
  removeTracking(url);
  const allowed=new Set(['id','p','page_id','page','year','semester','course','code','slug','programme']);
  for(const key of [...url.searchParams.keys()])if(!allowed.has(key.toLowerCase())||url.searchParams.get(key).length>80)url.searchParams.delete(key);
  url.searchParams.sort();
 }
 if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/,'');
 return url.href;
}
function extension(url){return new URL(url).pathname.split('.').at(-1)?.toLowerCase()||'';}
function isAssetUrl(url){return SAFE_FILE_EXTENSIONS.has(extension(url));}
function dateValue(value){return value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;}
function findXmlLocations(value,key){
 const item=value?.[key];if(!item)return [];
 return (Array.isArray(item)?item:[item]).map(entry=>typeof entry==='string'?entry:entry?.loc||entry?.['#text']).filter(value=>typeof value==='string'&&value.length<2048);
}
function getSourceDate(value){
 const date=value?.lastmod||value?.['lastmod'];return dateValue(typeof date==='string'?date:date?.['#text']);
}
function responsePathName(headers,url){
 const disposition=headers.get('content-disposition')||'';
 const match=disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
 let name=match?.[1]||new URL(url).pathname.split('/').at(-1)||'study-resource';
 try{name=decodeURIComponent(name);}catch{}
 return name.replace(/[\r\n\\/"<>:|?*\u0000-\u001f]/g,'_').slice(0,180)||'study-resource';
}
function extFromName(name){return name.includes('.')?name.split('.').at(-1).toLowerCase():'';}
function inferredExtension(type){return Object.entries(CONTENT_TYPES).find(([,value])=>value===type)?.[0]||'';}
function mimeFor(headers,name){
 const declared=(headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 const ext=extFromName(name);
 const candidate=declared==='application/octet-stream'&&CONTENT_TYPES[ext]?CONTENT_TYPES[ext]:declared;
 if(!SAFE_CONTENT_TYPES.has(candidate)||candidate==='application/octet-stream'&&!SAFE_FILE_EXTENSIONS.has(ext))return null;
 return {contentType:candidate,extension:SAFE_FILE_EXTENSIONS.has(ext)?ext:inferredExtension(candidate)};
}
function hasIdentifiableResultRows($,plainText){
 const headers=$('table th').map((_,node)=>clean($(node).text()).toLowerCase()).get();
 const headerText=headers.join(' '),tableText=$('table').text();
 const identifier=/(?:matric(?:ulation)?\s*(?:no\.?|number|id)?|reg(?:istration)?\s*(?:no\.?|number|id)|student\s*(?:name|id|number))/i;
 const resultField=/(?:result|grade|marks?|score|cgpa|gpa|course)/i;
 if(identifier.test(headerText)&&resultField.test(headerText))return true;
 return identifier.test(tableText)&&resultField.test(tableText)&&plainText.length>400;
}
function extractDocument(html,source,url){
 const $=cheerio.load(html);
 const requested=normalizeMirrorUrl(source,url,url);
 const canonicalHref=$('link[rel~="canonical"]').first().attr('href');
 const canonical=canonicalHref?normalizeMirrorUrl(source,canonicalHref,url):null;
 const title=clean($('meta[property="og:title"]').attr('content')||$('h1').first().text()||$('title').first().text()).slice(0,500)||new URL(url).pathname.split('/').filter(Boolean).at(-1)||source.name;
 const description=clean($('meta[name="description"]').attr('content')||$('meta[property="og:description"]').attr('content')||$('article p').first().text()||$('main p').first().text()).slice(0,1200);
 const publishedAt=dateValue($('meta[property="article:published_time"]').attr('content')||$('meta[name="datePublished"]').attr('content')||$('time[datetime]').first().attr('datetime'));
 const modifiedAt=dateValue($('meta[property="article:modified_time"]').attr('content')||$('meta[name="dateModified"]').attr('content'));
 const author=clean($('meta[name="author"]').attr('content')||$('meta[property="article:author"]').attr('content')).slice(0,180);
 const keywords=clean($('meta[name="keywords"]').attr('content')).split(/[,;|]/).map(value=>value.trim()).filter(Boolean).slice(0,30);
 const tags=$('meta[property="article:tag"]').map((_,node)=>clean($(node).attr('content'))).get().filter(Boolean).slice(0,30);
 const section=clean($('meta[property="article:section"]').attr('content')||$('meta[name="section"]').attr('content')).slice(0,120);
 const language=clean($('html').attr('lang')).slice(0,35);
 const headings=$('h1,h2,h3').map((_,node)=>clean($(node).text())).get().filter(Boolean).slice(0,80);
 const main=$('main,[role="main"],article').first();
 const body=main.length?main:$('body');
 const cleanBody=body.clone();cleanBody.find('script,style,nav,header,footer,aside,form,noscript,svg,iframe,button').remove();
 cleanBody.find('br').replaceWith('\n');
 cleanBody.find('p,h1,h2,h3,h4,li,blockquote,pre,tr,section,article,div').each((_,node)=>$(node).append('\n'));
 const sourceText=cleanBody.text().replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 if(hasIdentifiableResultRows($,sourceText))return {sensitive:true,requested,canonical:canonical||requested};
 const contentText=sourceText.slice(0,TEXT_LIMIT);
 const category=/course|study|exam|question|tma/i.test(title)?'Study materials':/admission|programme|eligib/i.test(title)?'Admissions':/result|fee|calendar|registration/i.test(title)?'Academics':/news|notice|announcement|update/i.test(title)?'News & notices':'Student information';
 const metadata={path:new URL(canonical||requested).pathname,author,keywords,tags,section,language,headings,category,contentTruncated:sourceText.length>TEXT_LIMIT};
 const discovered=new Map();
 const add=(href,linkTitle='',forceAsset=false)=>{
  let extensionLink=false;try{extensionLink=isAssetUrl(new URL(href,url).href);}catch{}
  const candidate=normalizeMirrorUrl(source,href,url,{asset:forceAsset||extensionLink});if(!candidate)return;
  const asset=forceAsset||extensionLink||isAssetUrl(candidate);
  const kind=asset?'asset':/\.(?:xml|xml\.gz)$/i.test(new URL(candidate).pathname)?'sitemap':'page';
  const key=kind+':'+candidate;
  if(candidate!==requested&& !discovered.has(key))discovered.set(key,{url:candidate,kind,title:clean(linkTitle).slice(0,180)});
 };
 $('a[href]').each((_,node)=>{const a=$(node);const href=a.attr('href');if(!href)return;const title=a.text()||a.attr('title')||'';add(href,title,a.attr('download')!==undefined);});
 $('iframe[src],embed[src],object[data]').each((_,node)=>{const el=$(node);const href=el.attr('src')||el.attr('data');if(href)add(href,el.attr('title')||'',true);});
 const links=[...discovered.values()].slice(0,MAX_LINKS_PER_PAGE);
 const contentHash=sha256(JSON.stringify([title,description,contentText,metadata]));
 return {sensitive:false,document:{requested,canonical:canonical||requested,title,description,contentText,contentHash,publishedAt,modifiedAt,metadata},links};
}
async function readBytesLimited(response,maxBytes,message='Source response exceeds the mirror size limit.'){
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error(message);}
 if(!response.body)return new Uint8Array();
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new Error(message);}chunks.push(value);}}
 finally{reader.releaseLock();}
 const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
 return joined;
}
async function readLimited(response,maxBytes){return new TextDecoder('utf-8',{fatal:false}).decode(await readBytesLimited(response,maxBytes));}
async function fetchSameOrigin(source,url,maxBytes){
 let current=normalizeMirrorUrl(source,url,url,{asset:true});if(!current)throw new Error('URL is outside the approved source host.');
 for(let redirects=0;redirects<=3;redirects++){
  let response;try{response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':USER_AGENT,Accept:'text/html,application/xhtml+xml,application/xml,text/plain,application/pdf,application/octet-stream;q=0.8'}});}catch{throw new Error('Source request failed.');}
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location||redirects===3)throw new Error('Source redirect is not supported.');const next=normalizeMirrorUrl(source,location,current,{asset:true});if(!next)throw new Error('Source redirect is outside the approved host.');current=next;continue;}
  if(!response.ok)throw new Error(`Source returned HTTP ${response.status}.`);
  return {response,url:current};
 }
 throw new Error('Source redirect limit exceeded.');
}
async function fetchText(source,url,maxBytes){
 const {response,url:finalUrl}=await fetchSameOrigin(source,url,maxBytes);
 const contentType=(response.headers.get('content-type')||'').toLowerCase();
 if(!/(?:text\/|application\/(?:xml|rss\+xml|atom\+xml|xhtml\+xml)|\+xml)/.test(contentType)&&!new URL(finalUrl).pathname.endsWith('.xml'))throw new Error('Source response is not text or XML.');
 return {text:await readLimited(response,maxBytes),url:finalUrl,contentType};
}
function parseSitemap(text,source,url){
 const locs=[];
 if(/\/robots\.txt(?:$|\?)/i.test(new URL(url).pathname)){
  for(const match of text.matchAll(/^\s*Sitemap\s*:\s*(\S+)/gim)){const safe=normalizeMirrorUrl(source,match[1],url,{asset:true});if(safe)locs.push({url:safe,kind:'sitemap',updatedAt:null});}
  return locs;
 }
 let parsed;try{parsed=parser.parse(text);}catch{return locs;}
 const sitemaps=findXmlLocations(parsed.sitemapindex,'sitemap');
 for(const entry of Array.isArray(parsed.sitemapindex?.sitemap)?parsed.sitemapindex.sitemap:parsed.sitemapindex?.sitemap?[parsed.sitemapindex.sitemap]:[]){const href=typeof entry==='string'?entry:entry?.loc;const safe=href&&normalizeMirrorUrl(source,href,url,{asset:true});if(safe)locs.push({url:safe,kind:'sitemap',updatedAt:getSourceDate(entry)});}
 for(const entry of Array.isArray(parsed.urlset?.url)?parsed.urlset.url:parsed.urlset?.url?[parsed.urlset.url]:[]){
  const href=typeof entry==='string'?entry:entry?.loc;const safe=href&&normalizeMirrorUrl(source,href,url,{asset:true});if(!safe)continue;
  locs.push({url:safe,kind:isAssetUrl(safe)?'asset':'page',updatedAt:getSourceDate(entry)});
 }
 if(!locs.length)for(const href of sitemaps){const safe=normalizeMirrorUrl(source,href,url,{asset:true});if(safe)locs.push({url:safe,kind:'sitemap',updatedAt:null});}
 return locs;
}
async function enqueue(env,source,items,parentUrl=null){
 const now=new Date().toISOString(),unique=new Map();
 for(const item of items){const safe=normalizeMirrorUrl(source,item.url,item.url,{asset:item.kind==='asset'||item.kind==='sitemap'});if(!safe||!['sitemap','page','asset'].includes(item.kind))continue;const key=item.kind+':'+safe;if(!unique.has(key))unique.set(key,{...item,url:safe});}
 const list=[...unique.values()];
 for(let index=0;index<list.length;index+=50){
  const writes=list.slice(index,index+50).map(item=>statement(env,`INSERT INTO mirror_crawl_queue(source,url,kind,state,attempts,source_updated_at,parent_url,discovered_at,updated_at)
   VALUES(?,?,?,'pending',0,?,?,?,?) ON CONFLICT(source,url,kind) DO UPDATE SET
   source_updated_at=COALESCE(excluded.source_updated_at,mirror_crawl_queue.source_updated_at),
   parent_url=COALESCE(excluded.parent_url,mirror_crawl_queue.parent_url),
   state=CASE WHEN mirror_crawl_queue.state='error' OR (excluded.source_updated_at IS NOT NULL AND excluded.source_updated_at>COALESCE(mirror_crawl_queue.source_updated_at,'')) THEN 'pending' ELSE mirror_crawl_queue.state END,
   attempts=CASE WHEN mirror_crawl_queue.state='error' OR (excluded.source_updated_at IS NOT NULL AND excluded.source_updated_at>COALESCE(mirror_crawl_queue.source_updated_at,'')) THEN 0 ELSE mirror_crawl_queue.attempts END,
   last_error=CASE WHEN mirror_crawl_queue.state='error' OR (excluded.source_updated_at IS NOT NULL AND excluded.source_updated_at>COALESCE(mirror_crawl_queue.source_updated_at,'')) THEN NULL ELSE mirror_crawl_queue.last_error END,
   updated_at=CASE WHEN mirror_crawl_queue.state='error' OR (excluded.source_updated_at IS NOT NULL AND excluded.source_updated_at>COALESCE(mirror_crawl_queue.source_updated_at,'')) THEN excluded.updated_at ELSE mirror_crawl_queue.updated_at END`,source.id,item.url,item.kind,item.updatedAt||null,item.parentUrl||parentUrl,now,now));
  await env.DB.batch(writes);
 }
 return list.length;
}
async function queueState(env,source,url,kind,state,error=''){
 const now=new Date().toISOString();
 await statement(env,'UPDATE mirror_crawl_queue SET state=?,attempts=attempts+1,last_error=?,updated_at=? WHERE source=? AND url=? AND kind=?',state,String(error).slice(0,500),now,source.id,url,kind).run();
}
async function storePage(env,source,url,html){
 const parsed=extractDocument(html,source,url);
 const now=new Date().toISOString();
 if(parsed.sensitive){
  const existing=await records(env,'SELECT id FROM mirror_documents WHERE source=? AND canonical_url IN (?,?)',source.id,parsed.canonical,parsed.requested);
  if(existing.length){
   const ids=existing.map(row=>row.id),slots=ids.map(()=>'?').join(',');
   const assets=await records(env,`SELECT object_key FROM mirror_assets WHERE document_id IN (${slots})`,...ids);
   if(env.CONTENT)await Promise.allSettled(assets.map(asset=>env.CONTENT.delete(asset.object_key)));
   await env.DB.batch([
    statement(env,`DELETE FROM mirror_assets WHERE document_id IN (${slots})`,...ids),
    statement(env,`DELETE FROM mirror_documents WHERE id IN (${slots})`,...ids)
   ]);
  }
  return {documentId:null,links:[],sensitive:true};
 }
 const d=parsed.document;
 const old=await statement(env,'SELECT id,first_seen_at FROM mirror_documents WHERE source=? AND canonical_url=?',source.id,d.canonical).first();
 const id=old?.id||sha256(source.id+'\0'+d.canonical).slice(0,32);
 await statement(env,`INSERT INTO mirror_documents(id,source,canonical_url,title,description,content_text,content_type,source_published_at,source_modified_at,first_seen_at,last_seen_at,content_hash,metadata)
  VALUES(?,?,?,?,? ,?,'text/html',?,?,?,?,?,?) ON CONFLICT(source,canonical_url) DO UPDATE SET
  title=excluded.title,description=excluded.description,content_text=excluded.content_text,content_type=excluded.content_type,
  source_published_at=COALESCE(excluded.source_published_at,mirror_documents.source_published_at),
  source_modified_at=COALESCE(excluded.source_modified_at,mirror_documents.source_modified_at),last_seen_at=excluded.last_seen_at,
  content_hash=excluded.content_hash,metadata=excluded.metadata`,id,source.id,d.canonical,d.title,d.description,d.contentText,d.publishedAt,d.modifiedAt,old?.first_seen_at||now,now,d.contentHash,JSON.stringify(d.metadata)).run();
 const saved=await statement(env,'SELECT id FROM mirror_documents WHERE source=? AND canonical_url=?',source.id,d.canonical).first();
 const links=parsed.links.map(link=>({...link,parentUrl:d.canonical,documentId:saved?.id||id}));
 return {documentId:saved?.id||id,links,sensitive:false};
}
function xmlDateUpdated(value){return value&&Date.parse(value)?new Date(value).toISOString():null;}
async function processSitemap(env,source,row){
 const {text}=await fetchText(source,row.url,SITEMAP_BYTE_LIMIT);
 const items=parseSitemap(text,source,row.url).map(item=>({...item,updatedAt:xmlDateUpdated(item.updatedAt),parentUrl:row.url}));
 await enqueue(env,source,items,row.url);
 await queueState(env,source,row.url,'sitemap','done');
}
async function processPage(env,source,row){
 const {text,url,contentType}=await fetchText(source,row.url,HTML_LIMIT);
 if(!/(?:text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType))throw new Error('Source page is not HTML.');
 const result=await storePage(env,source,url,text);
 await enqueue(env,source,result.links,row.url);
 await queueState(env,source,row.url,'page','done',result.sensitive?'Skipped identifiable student-result table.':'');
}
async function processAsset(env,source,row){
 if(!env.CONTENT)return false;
 const {response,url}=await fetchSameOrigin(source,row.url,FILE_LIMIT);
 const name=responsePathName(response.headers,url),mime=mimeFor(response.headers,name);
 if(!mime)throw new Error('File type is not permitted for local storage.');
 const sizeHeader=Number(response.headers.get('content-length'));
 if(Number.isFinite(sizeHeader)&&sizeHeader>FILE_LIMIT){await response.body?.cancel();throw new Error('File exceeds the local storage size limit.');}
 const assetId=sha256(source.id+'\0'+url).slice(0,32),objectKey=`mirror/${source.id}/${assetId}.${mime.extension||'bin'}`;
 const fallbackName=name.replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,180)||'study-resource';
 const httpMetadata={contentType:'application/octet-stream',contentDisposition:`attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(name)}`};
 const customMetadata={source:source.id,sourceUrlHash:sha256(url)};
 let object,bytes=0;
 if(response.body&&Number.isSafeInteger(sizeHeader)&&sizeHeader>0){
  // Preserve a fixed-length upload stream without buffering large files. The
  // stream enforces the advertised size, so an upstream cannot evade the cap
  // by sending more bytes than its Content-Length claims.
  let transferred=0;
  const limited=response.body.pipeThrough(new TransformStream({transform(chunk,controller){
   transferred+=chunk.byteLength;
   if(transferred>FILE_LIMIT)throw new Error('File exceeds the local storage size limit.');
   controller.enqueue(chunk);
  }}));
  const fixedLength=new FixedLengthStream(sizeHeader);
  const upload=env.CONTENT.put(objectKey,fixedLength.readable,{httpMetadata,customMetadata});
  const transfer=limited.pipeTo(fixedLength.writable);
  [object]=await Promise.all([upload,transfer]);
  bytes=transferred;
 }else{
  const data=await readBytesLimited(response,UNKNOWN_LENGTH_FILE_LIMIT,'Files without a Content-Length header are limited to 20 MB.');bytes=data.byteLength;
  object=await env.CONTENT.put(objectKey,new Blob([data],{type:'application/octet-stream'}),{httpMetadata,customMetadata});
 }
 if(!bytes)throw new Error('File is empty or unavailable.');
 const now=new Date().toISOString();
 const parent=row.parent_url?await statement(env,'SELECT id FROM mirror_documents WHERE source=? AND canonical_url=?',source.id,row.parent_url).first():null;
 let documentId=parent?.id||null;
 if(!documentId){
  const existing=await statement(env,'SELECT id,first_seen_at FROM mirror_documents WHERE source=? AND canonical_url=?',source.id,url).first();
  documentId=existing?.id||sha256(source.id+'\\0file\\0'+url).slice(0,32);
  const metadata=JSON.stringify({path:new URL(url).pathname,author:'',keywords:[],headings:[],category:'Study materials',assetOnly:true});
  await statement(env,`INSERT INTO mirror_documents(id,source,canonical_url,title,description,content_text,content_type,source_published_at,source_modified_at,first_seen_at,last_seen_at,content_hash,metadata)
   VALUES(?,?,?,?,?,?,?,NULL,NULL,?,?,?,?) ON CONFLICT(source,canonical_url) DO UPDATE SET title=excluded.title,description=excluded.description,content_text=excluded.content_text,content_type=excluded.content_type,last_seen_at=excluded.last_seen_at,content_hash=excluded.content_hash,metadata=excluded.metadata`,documentId,source.id,url,name,'Study file available in the local collection.',name,mime.contentType,existing?.first_seen_at||now,now,sha256(name+'\\0'+mime.contentType),metadata).run();
 }
 await statement(env,`INSERT INTO mirror_assets(id,document_id,source,source_url,object_key,file_name,content_type,byte_size,etag,first_seen_at,last_seen_at,metadata)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_url) DO UPDATE SET document_id=COALESCE(excluded.document_id,mirror_assets.document_id),object_key=excluded.object_key,file_name=excluded.file_name,content_type=excluded.content_type,byte_size=excluded.byte_size,etag=excluded.etag,last_seen_at=excluded.last_seen_at,metadata=excluded.metadata`,assetId,documentId,source.id,url,objectKey,name,mime.contentType,object?.size??bytes,object?.etag||null,now,now,JSON.stringify({extension:mime.extension,sourcePath:new URL(url).pathname})).run();
 await queueState(env,source,row.url,'asset','done');
 return true;
}
async function processBatch(env,source,kind,limit,handler,concurrency=3){
 const queue=await records(env,'SELECT source,url,kind,source_updated_at,parent_url FROM mirror_crawl_queue WHERE source=? AND kind=? AND state=\'pending\' ORDER BY COALESCE(source_updated_at,discovered_at) DESC,discovered_at DESC LIMIT ?',source.id,kind,limit);
 for(let index=0;index<queue.length;index+=concurrency){
  await Promise.all(queue.slice(index,index+concurrency).map(async row=>{
   try{await handler(env,source,row);}
   catch(error){await queueState(env,source,row.url,kind,'error',error?.message||'Source refresh failed');}
  }));
 }
 return queue.length;
}
async function prepareSource(env,source){
 const now=Date.now(),nowIso=new Date(now).toISOString();
 await statement(env,'INSERT INTO mirror_crawl_state(source) VALUES(?) ON CONFLICT(source) DO NOTHING',source.id).run();
 const state=await statement(env,'SELECT last_discovery_at FROM mirror_crawl_state WHERE source=?',source.id).first();
 const discovered=Date.parse(state?.last_discovery_at||'')||0;
 if(now-discovered>=DAY_MS){
  const urls=[{url:source.url,kind:'page'}];
  for(const path of ['/robots.txt','/sitemap.xml','/sitemap_index.xml','/wp-sitemap.xml'])urls.push({url:new URL(path,source.url).href,kind:'sitemap'});
  await enqueue(env,source,urls);
  await statement(env,'UPDATE mirror_crawl_state SET last_discovery_at=?,last_error=NULL WHERE source=?',nowIso,source.id).run();
 }
 const staleCutoff=new Date(now-DAY_MS).toISOString();
 // Refresh sitemaps daily so additions beyond a site's homepage links are discovered.
 await statement(env,"UPDATE mirror_crawl_queue SET state='pending',attempts=0,last_error=NULL,updated_at=? WHERE source=? AND kind='sitemap' AND state='done' AND updated_at<?",nowIso,source.id,staleCutoff).run();
 await statement(env,`UPDATE mirror_crawl_queue SET state='pending',attempts=0,last_error=NULL,updated_at=? WHERE source=? AND kind='page' AND state='done' AND url IN
  (SELECT url FROM mirror_crawl_queue WHERE source=? AND kind='page' AND state='done' AND updated_at<? ORDER BY updated_at LIMIT ?)`,nowIso,source.id,source.id,staleCutoff,Math.max(4,Math.floor(PAGE_LIMIT/3))).run();
 await statement(env,`UPDATE mirror_crawl_queue SET state='pending',attempts=0,last_error=NULL,updated_at=? WHERE source=? AND kind='page' AND state='error' AND updated_at<?`,nowIso,source.id,staleCutoff).run();
 await statement(env,`UPDATE mirror_crawl_queue SET state='pending',attempts=0,last_error=NULL,updated_at=? WHERE source=? AND kind='asset' AND state='error' AND updated_at<?`,nowIso,source.id,staleCutoff).run();
}
async function updateSourceState(env,source){
 const counts=await records(env,'SELECT kind,state,count(*) AS total FROM mirror_crawl_queue WHERE source=? GROUP BY kind,state',source.id);
 const pages=counts.find(row=>row.kind==='page'&&['pending','error'].includes(row.state))?.total||0;
 const assets=counts.find(row=>row.kind==='asset'&&['pending','error'].includes(row.state))?.total||0;
 await statement(env,'UPDATE mirror_crawl_state SET last_crawl_at=?,pending_pages=?,pending_assets=? WHERE source=?',new Date().toISOString(),pages,assets,source.id).run();
}
export async function syncContentMirror(env){
 if(!env.DB)return;
 try{
  await Promise.all(sources.map(async source=>{
   await prepareSource(env,source);
   await processBatch(env,source,'sitemap',SITEMAP_LIMIT,processSitemap);
   await processBatch(env,source,'page',PAGE_LIMIT,processPage);
   if(env.CONTENT)await processBatch(env,source,'asset',ASSET_LIMIT,processAsset,1);
   await updateSourceState(env,source);
  }));
 }catch(error){console.warn('Local content mirror refresh is unavailable:',error?.message||String(error));}
}
