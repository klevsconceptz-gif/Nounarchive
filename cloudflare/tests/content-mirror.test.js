import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {normalizeMirrorUrl} from '../content-mirror.js';
import {passwordKey,randomToken} from '../security.js';

const files=['0001_initial.sql','0002_admin_recovery.sql','0003_resources.sql','0004_content_mirror.sql'];
const migrations=async db=>{for(const file of files)for(const sql of (await readFile('cloudflare/migrations/'+file,'utf8')).split(';').map(value=>value.trim()).filter(Boolean))await db.prepare(sql).run();};
const mirrorUrl={id:'bbcnoun',name:'BBCNOUN',url:'https://bbcnoun.com.ng/'};

test('mirror URL policy only accepts approved HTTPS hosts and excludes private result routes',()=>{
 assert.equal(normalizeMirrorUrl(mirrorUrl,'https://bbcnoun.com.ng/notes/?utm_source=mail#section'), 'https://bbcnoun.com.ng/notes');
 assert.equal(normalizeMirrorUrl(mirrorUrl,'https://www.bbcnoun.com.ng/notes/'),'https://www.bbcnoun.com.ng/notes');
 assert.equal(normalizeMirrorUrl(mirrorUrl,'https://evil.example/notes'),null);
 assert.equal(normalizeMirrorUrl(mirrorUrl,'http://bbcnoun.com.ng/notes'),null);
 assert.equal(normalizeMirrorUrl(mirrorUrl,'https://bbcnoun.com.ng/results.php?matric=123'),null);
 assert.equal(normalizeMirrorUrl(mirrorUrl,'https://bbcnoun.com.ng/course.php?id=123&token=secret'),'https://bbcnoun.com.ng/course.php?id=123');
});

test('daily mirror crawls same-site pages, stores study files in R2, and serves only local URLs',async()=>{
 const html=(title,body)=>`<!doctype html><html><head><title>${title}</title><meta name="description" content="A local study reference"></head><body><header>Navigation should not be in the stored page.</header><main><h1>${title}</h1><article>${body}</article></main><footer>Footer words should not be stored.</footer></body></html>`;
 let includeDailyAddedPage=false;
 const outboundService=async request=>{
  const url=new URL(request.url);
  if(url.hostname==='bbcnoun.com.ng'){
   if(url.pathname==='/feed/')return new Response('<rss><channel><item><title>BBCNOUN local mirror test headline for students</title><link>https://bbcnoun.com.ng/news/mirror-test</link><description>Test summary.</description></item></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});
   if(url.pathname==='/robots.txt')return new Response('User-agent: *\nSitemap: https://bbcnoun.com.ng/sitemap.xml\n',{headers:{'Content-Type':'text/plain'}});
   if(url.pathname==='/sitemap.xml')return new Response(`<urlset><url><loc>https://bbcnoun.com.ng/study/course-guide</loc><lastmod>2026-10-21</lastmod></url><url><loc>https://bbcnoun.com.ng/files/past-question.pdf</loc></url><url><loc>https://bbcnoun.com.ng/private-results</loc></url><url><loc>https://bbcnoun.com.ng/records/semester-report</loc></url>${includeDailyAddedPage?'<url><loc>https://bbcnoun.com.ng/study/daily-added</loc><lastmod>2026-10-29</lastmod></url>':''}</urlset>`,{headers:{'Content-Type':'application/xml'}});
   if(url.pathname==='/')return new Response(html('BBCNOUN Study Collection','<p>Root page includes a course guide.</p><a href="/study/course-guide">Course guide</a>'),{headers:{'Content-Type':'text/html'}});
   if(url.pathname==='/study/course-guide')return new Response(html('Course Guide','<p>This locally mirrored course guide contains a searchable paragraph for the syllabus and course study plan.</p><a href="/files/past-question.pdf">Download the past question PDF</a><a href="/files/unknown-length.pdf">Large file without a size header</a><a href="https://outside.example/private.pdf">External file must be ignored</a><script>unsafe injected content</script>'),{headers:{'Content-Type':'text/html'}});
   if(url.pathname==='/study/daily-added')return new Response(html('Daily Added Study Guide','<p>This page appeared in the updated sitemap after the initial crawl.</p>'),{headers:{'Content-Type':'text/html'}});
   if(url.pathname==='/private-results'||url.pathname==='/records/semester-report')return new Response(html('Private results notice','<table><thead><tr><th>Student Name</th><th>Matriculation Number</th><th>Course</th><th>Grade</th></tr></thead><tbody><tr><td>Alice Example</td><td>NOU12345678</td><td>ABC101</td><td>A</td></tr></tbody></table>'),{headers:{'Content-Type':'text/html'}});
   if(url.pathname==='/files/past-question.pdf')return new Response(new Uint8Array([37,80,68,70,45,49,46,52]),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="past-question.pdf"','Content-Length':'8'}});
   if(url.pathname==='/files/unknown-length.pdf')return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(20_000_001));controller.close();}}),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="unknown-length.pdf"'}});
  }
  if(url.hostname==='nounupdate.com'){
   if(url.pathname==='/news/')return new Response(html('NOUN Update News List','<article><h2><a href="/news/example-update">NOUN Update publishes a local mirror test notice</a></h2><p>Test notice excerpt.</p></article>'),{headers:{'Content-Type':'text/html'}});
   if(url.pathname==='/')return new Response(html('NOUN Update Resources','<a href="/courses/course-notes">Course notes and study materials</a>'),{headers:{'Content-Type':'text/html'}});
  }
  if(url.hostname==='puredu.net')return new Response(html('Puredu Campus Report','<article><h2><a href="/post/example-update">Puredu published a local mirror test report</a></h2><p>Report summary.</p></article>'),{headers:{'Content-Type':'text/html'}});
  if(['nounupdate.com','puredu.net'].includes(url.hostname)&&url.pathname==='/robots.txt')return new Response('User-agent: *\n',{headers:{'Content-Type':'text/plain'}});
  return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain'}});
 };
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/worker.js',compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat','service_binding_extra_handlers'],d1Databases:['DB'],kvNamespaces:{kv:'test-kv'},r2Buckets:{CONTENT:'test-content'},bindings:{STUDENT_RESULTS_ENCRYPTION_KEY:randomBytes(32).toString('base64url')},outboundService}));
 try{
  const db=await mf.getD1Database('DB');await migrations(db);
  const bucket=await mf.getR2Bucket('CONTENT'),oldObjectKey='mirror/bbcnoun/old-result-file.pdf',now='2026-10-01T00:00:00.000Z';
  await bucket.put(oldObjectKey,new Uint8Array([1,2,3]));
  await db.prepare(`INSERT INTO mirror_documents(id,source,canonical_url,title,description,content_text,content_type,first_seen_at,last_seen_at,content_hash,metadata) VALUES(?,?,?,?,?,?,'text/html',?,?,?,'{}')`).bind('c'.repeat(32),'bbcnoun','https://bbcnoun.com.ng/records/semester-report','Old report','Old summary','Student Name Matriculation Number Grade Alice Example NOU12345678 A',now,now,'old-hash').run();
  await db.prepare(`INSERT INTO mirror_assets(id,document_id,source,source_url,object_key,file_name,content_type,byte_size,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind('d'.repeat(32),'c'.repeat(32),'bbcnoun','https://bbcnoun.com.ng/records/semester-report-file.pdf',oldObjectKey,'old-result-file.pdf','application/pdf',3,now,now).run();
  const worker=await mf.getWorker();const result=await worker.scheduled({scheduledTime:new Date(),cron:'0 0 * * *'});assert.equal(result.outcome,'ok');
  const documents=(await db.prepare('SELECT id,canonical_url,title,content_text FROM mirror_documents').all()).results;
  const guide=documents.find(item=>item.title==='Course Guide');assert.ok(guide);assert.doesNotMatch(guide.content_text,/Navigation should not|Footer words|unsafe injected/i);
  assert.equal(documents.some(item=>/private-results|semester-report/.test(item.canonical_url)),false);
  assert.equal(documents.some(item=>/Alice Example|NOU12345678/.test(item.content_text)),false);
  assert.equal(await bucket.get(oldObjectKey),null,'previous public files are removed when a page becomes sensitive');
  assert.equal(await db.prepare('SELECT id FROM mirror_assets WHERE id=?').bind('d'.repeat(32)).first(),null);
  const asset=(await db.prepare('SELECT id,object_key,source_url,document_id FROM mirror_assets WHERE file_name=?').bind('past-question.pdf').first());assert.ok(asset);assert.match(asset.object_key,/^mirror\/bbcnoun\//);assert.ok(asset.document_id);
  const oversized=await db.prepare("SELECT state,last_error FROM mirror_crawl_queue WHERE source='bbcnoun' AND url='https://bbcnoun.com.ng/files/unknown-length.pdf' AND kind='asset'").first();assert.equal(oversized.state,'error');assert.match(oversized.last_error,/without a Content-Length header are limited to 20 MB/);
  assert.equal(await db.prepare("SELECT id FROM mirror_assets WHERE source_url='https://bbcnoun.com.ng/files/unknown-length.pdf'").first(),null);
  const object=await bucket.get(asset.object_key);assert.ok(object);assert.equal(object.size,8);
  const search=await mf.dispatchFetch('https://nounarchive.test/api/content?q=syllabus');assert.equal(search.status,200);const response=await search.json();assert.ok(response.items.some(item=>item.id===guide.id));assert.ok(!JSON.stringify(response).includes('https://bbcnoun.com.ng'));assert.ok(!JSON.stringify(response).includes('source'));
  const detail=await (await mf.dispatchFetch('https://nounarchive.test/api/content/'+guide.id)).json();assert.equal(detail.title,'Course Guide');assert.match(detail.content,/searchable paragraph/);assert.equal(detail.assets[0].downloadUrl,'/api/content/assets/'+asset.id);assert.ok(!JSON.stringify(detail).includes('canonical_url'));assert.ok(!JSON.stringify(detail).includes('https://bbcnoun.com.ng'));
  const download=await mf.dispatchFetch('https://nounarchive.test'+detail.assets[0].downloadUrl);assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal((await download.arrayBuffer()).byteLength,8);
  includeDailyAddedPage=true;
  await db.prepare("UPDATE mirror_crawl_state SET last_discovery_at='2000-01-01T00:00:00.000Z' WHERE source='bbcnoun'").run();
  await db.prepare("UPDATE mirror_crawl_queue SET updated_at='2000-01-01T00:00:00.000Z' WHERE source='bbcnoun' AND kind='sitemap' AND state='done'").run();
  const refreshed=await worker.scheduled({scheduledTime:new Date(),cron:'0 0 * * *'});assert.equal(refreshed.outcome,'ok');
  const added=await db.prepare("SELECT id,title FROM mirror_documents WHERE title='Daily Added Study Guide'").first();assert.ok(added,'a later scheduled crawl refreshes completed sitemaps');
 }finally{await mf.dispose();}
});

test('student results import is authenticated, encrypted at rest, paginated and excluded from public APIs',async()=>{
 const password='local-only-test-password',salt=randomToken(),hash=`pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`,key=randomBytes(32).toString('base64url');
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'dist/worker/worker.js',compatibilityDate:'2026-10-30',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_PASSWORD_HASH:hash,STUDENT_RESULTS_ENCRYPTION_KEY:key}}));
 try{
  const db=await mf.getD1Database('DB');await migrations(db);
  const request=(path,method='GET',body,token='')=>mf.dispatchFetch('https://nounarchive.test/api'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.17','X-Nounarchive-Admin':'1','X-CSRF-Token':token,Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let cookie='';
  assert.equal((await request('/admin/student-results/batches')).status,401);
  const login=await request('/admin/login','POST',{password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];const csrf=(await login.json()).csrf;
  const created=await request('/admin/student-results/batches','POST',{format:'json',totalRecords:2},csrf);assert.equal(created.status,201);const {batchId}=await created.json();
  const records=[{studentName:'Private Example',matricNumber:'NOU12345678',course:'ABC101',grade:'A'},{studentName:'Private Other',matricNumber:'NOU87654321',course:'XYZ202',grade:'B'}];
  const imported=await request(`/admin/student-results/batches/${batchId}/import`,'POST',{offset:0,records},csrf);assert.equal(imported.status,200);assert.deepEqual(await imported.json(),{batchId,importedRecords:2,totalRecords:2,complete:true});
  const stored=(await db.prepare('SELECT ciphertext,iv FROM private_student_results WHERE batch_id=? ORDER BY row_index').bind(batchId).all()).results;
  assert.equal(stored.length,2);assert.ok(stored.every(row=>!row.ciphertext.includes('Private Example')&&!row.ciphertext.includes('NOU12345678')));
  const list=await request('/admin/student-results/batches');assert.equal(list.status,200);assert.equal((await list.json()).batches[0].imported_records,2);
  const page=await request(`/admin/student-results/batches/${batchId}?limit=1&offset=0`);assert.equal(page.status,200);const first=await page.json();assert.equal(first.items.length,1);assert.deepEqual(first.items[0].data,records[0]);assert.equal(first.nextOffset,1);
  const second=await request(`/admin/student-results/batches/${batchId}?limit=1&offset=1`);assert.deepEqual((await second.json()).items[0].data,records[1]);
  const publicSearch=await mf.dispatchFetch('https://nounarchive.test/api/content?q=private+example');assert.equal(publicSearch.status,200);assert.equal((await publicSearch.json()).items.length,0);
  assert.equal((await mf.dispatchFetch('https://nounarchive.test/api/admin/student-results/batches')).status,401);
  assert.equal((await request('/admin/logout','POST',{},csrf)).status,200);
  const deleted=await request(`/admin/student-results/batches/${batchId}`,'DELETE',{},csrf);assert.equal(deleted.status,401);
 }finally{await mf.dispose();}
});
