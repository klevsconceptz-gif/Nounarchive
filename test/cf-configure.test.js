import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const script=resolve('scripts/cf-configure.js');
const paths=['wrangler.jsonc','wrangler.pages.jsonc','wrangler.scheduler.jsonc'];
// Test fixture UUID, never used for a remote operation.
const fixture='11111111-2222-4333-8444-555555555555';
test('build environment configures D1 before deployment; invalid and missing IDs fail early',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nounarchive-config-'));
 const env={...process.env};delete env.D1_DATABASE_ID;
 const run=extra=>spawnSync(process.execPath,[script,'--check'],{cwd:dir,env:{...env,...extra},encoding:'utf8'});
 try{
 for(const path of paths)await writeFile(join(dir,path),JSON.stringify({d1_databases:[{binding:'DB',database_id:'REPLACE_WITH_D1_DATABASE_ID'}]}));
 let result=run({});assert.notEqual(result.status,0);assert.match(result.stderr,/D1_DATABASE_ID/);
 result=run({D1_DATABASE_ID:'nounarchive'});assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid D1_DATABASE_ID/);
 assert.equal(JSON.parse(await readFile(join(dir,paths[0]),'utf8')).d1_databases[0].database_id,'REPLACE_WITH_D1_DATABASE_ID');
 result=run({D1_DATABASE_ID:fixture});assert.equal(result.status,0,result.stderr);
 for(const path of paths)assert.equal(JSON.parse(await readFile(join(dir,path),'utf8')).d1_databases[0].database_id,fixture);
 assert.equal(run({}).status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
