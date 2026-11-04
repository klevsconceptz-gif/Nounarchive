import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sources} from '../aggregator.js';
import {refreshArchive,REFRESH_MS} from '../news-sync.js';

test('hourly imports deduplicate updates, preserve dates and continue past a failed provider',async()=>{
 const old={id:'old',source:'bbcnoun',title:'Previous headline',publishedAt:'2026-04-02T00:00:00.000Z',excerpt:'Previous summary'};
 const original={items:[old],status:{nounupdate:{state:'ok',lastSuccess:'2026-10-01'}}},checkedAt='2026-11-04T12:00:00.000Z',calls=[];
 const collector=async source=>{calls.push(source.id);if(source.id==='nounupdate')throw Error('Request failed');return source.id==='bbcnoun'?[{...old,title:'Updated headline',publishedAt:null,excerpt:''}]:[{id:'new',source:source.id,title:'A new headline',publishedAt:null,excerpt:'New short summary'}];};
 const refreshed=await refreshArchive(original,collector,()=>checkedAt);
 assert.deepEqual(calls,sources.map(s=>s.id));assert.equal(refreshed.items.length,2);assert.equal(refreshed.items[0].title,'Updated headline');assert.equal(refreshed.items[0].publishedAt,old.publishedAt);assert.equal(refreshed.items[0].excerpt,old.excerpt);
 assert.equal(refreshed.status.nounupdate.state,'error');assert.equal(refreshed.status.nounupdate.lastSuccess,'2026-10-01');assert.equal(refreshed.status.puredu.lastSuccess,checkedAt);
 assert.equal(original.items[0].title,'Previous headline');assert.equal(original.status.nounupdate.state,'ok');
 const again=await refreshArchive(refreshed,collector,()=>checkedAt);assert.equal(again.items.length,2);
});
test('empty provider results retain the archive and are not labelled successful',async()=>{
 const original={items:[{id:'existing'}],status:{}};const result=await refreshArchive(original,async()=>[]);
 assert.deepEqual(result.items,original.items);for(const source of sources)assert.equal(result.status[source.id].state,'error');
});
test('Node and both Cloudflare deployment targets are configured for hourly collection',async()=>{
 assert.equal(REFRESH_MS,3600000);
 for(const file of ['wrangler.jsonc','wrangler.scheduler.jsonc'])assert.deepEqual(JSON.parse(await readFile(file,'utf8')).triggers.crons,['0 * * * *']);
 assert.match(await readFile('server.js','utf8'),/setInterval\(.*REFRESH_MS/);
 for(const file of ['cloudflare/worker.js','cloudflare/scheduler.js'])assert.match(await readFile(file,'utf8'),/scheduled\(event,env,ctx\).*waitUntil\(syncSources\(env\)\)/);
});
