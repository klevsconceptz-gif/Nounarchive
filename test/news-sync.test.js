import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sources,resourceSources} from '../aggregator.js';
import {refreshArchive,REFRESH_MS} from '../news-sync.js';
import {refreshResourceArchive} from '../resource-sync.js';

test('daily news imports deduplicate updates, preserve dates, and continue past a failed provider',async()=>{
 const old={id:'old',source:'bbcnoun',title:'Previous headline',publishedAt:'2026-04-02T00:00:00.000Z',excerpt:'Previous summary'};
 const original={items:[old],status:{nounupdate:{state:'ok',lastSuccess:'2026-10-01'}}},checkedAt='2026-11-04T00:00:00.000Z',calls=[];
 const collector=async source=>{calls.push(source.id);if(source.id==='nounupdate')throw Error('Request failed');return source.id==='bbcnoun'?[{...old,title:'Updated headline',publishedAt:null,excerpt:''}]:[{id:'new',source:source.id,title:'A new headline',publishedAt:null,excerpt:'New short summary'}];};
 const refreshed=await refreshArchive(original,collector,()=>checkedAt);
 assert.deepEqual(calls,sources.map(s=>s.id));assert.equal(refreshed.items.length,2);assert.equal(refreshed.items[0].title,'Updated headline');assert.equal(refreshed.items[0].publishedAt,old.publishedAt);assert.equal(refreshed.items[0].excerpt,old.excerpt);
 assert.equal(refreshed.status.nounupdate.state,'error');assert.equal(refreshed.status.nounupdate.lastSuccess,'2026-10-01');assert.equal(refreshed.status.puredu.lastSuccess,checkedAt);
 assert.equal(original.items[0].title,'Previous headline');assert.equal(original.status.nounupdate.state,'ok');
 const again=await refreshArchive(refreshed,collector,()=>checkedAt);assert.equal(again.items.length,2);
});

test('empty news provider results retain the archive and are not labelled successful',async()=>{
 const original={items:[{id:'existing'}],status:{}};const result=await refreshArchive(original,async()=>[]);
 assert.deepEqual(result.items,original.items);for(const source of sources)assert.equal(result.status[source.id].state,'error');
});

test('daily resource refresh updates matching records, discovers new ones, and preserves data on failure',async()=>{
 const original={items:[
  {id:'course-materials',source:'NOUN Update',url:'https://nounupdate.com/courses/',title:'Course materials',description:'Old description'},
  {id:'legacy',source:'Puredu',url:'https://puredu.net/old-resource',title:'Older saved resource'}
 ],status:{bbcnoun:{state:'ok',lastSuccess:'2026-10-01'}}};
 const checkedAt='2026-11-04T00:00:00.000Z',calls=[];
 const collector=async source=>{
  calls.push(source.id);
  if(source.id==='bbcnoun')throw Error('Provider unavailable');
  return [
   {id:'crawler-new-id',source:source.name,url:'https://nounupdate.com/courses/',title:'Course materials updated',description:'Fresh local description',localTool:'library',category:'Study & examinations'},
   {id:'brand-new',source:source.name,url:'https://nounupdate.com/new-tool',title:'New tool',description:'New local tool',localTool:'notebook',category:'Student support'}
  ];
 };
 const refreshed=await refreshResourceArchive(original,collector,()=>checkedAt);
 assert.deepEqual(calls,resourceSources.map(source=>source.id));
 assert.equal(refreshed.items.length,3);
 const updated=refreshed.items.find(item=>item.title==='Course materials updated');
 assert.equal(updated.id,'course-materials');assert.equal(updated.firstSeenAt,checkedAt);assert.equal(updated.lastSeenAt,checkedAt);
 assert.ok(refreshed.items.some(item=>item.id==='brand-new'));
 assert.ok(refreshed.items.some(item=>item.id==='legacy'));
 assert.equal(refreshed.status.bbcnoun.state,'error');assert.equal(refreshed.status.bbcnoun.lastSuccess,'2026-10-01');
 assert.equal(original.items[0].title,'Course materials');
});

test('empty resource results retain the catalogue and are not labelled successful',async()=>{
 const original={items:[{id:'existing'}],status:{}};const result=await refreshResourceArchive(original,async()=>[]);
 assert.deepEqual(result.items,original.items);for(const source of resourceSources)assert.equal(result.status[source.id].state,'error');
});

test('Node and both Cloudflare deployment targets refresh the archive daily',async()=>{
 assert.equal(REFRESH_MS,86400000);
 for(const file of ['wrangler.jsonc','wrangler.scheduler.jsonc'])assert.deepEqual(JSON.parse(await readFile(file,'utf8')).triggers.crons,['0 0 * * *']);
 assert.match(await readFile('server.js','utf8'),/setInterval\(.*REFRESH_MS/);
 assert.match(await readFile('server.js','utf8'),/api\/resources.*refreshMinutes: Math.round\(REFRESH_MS \/ 60_000\)/);
 assert.match(await readFile('server.js','utf8'),/refreshResourceArchive/);
 for(const file of ['cloudflare/worker.js','cloudflare/scheduler.js'])assert.match(await readFile(file,'utf8'),/scheduled\(event,env,ctx\).*waitUntil\(syncSources\(env\)\)/);
 assert.match(await readFile('cloudflare/api.js','utf8'),/resourceSources\.map\(source=>syncResourceSource\(env,source\)\)/);
});
