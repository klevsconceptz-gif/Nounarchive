import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('GitHub workflows parse and production deployment is manual and branch-scoped',async()=>{
 const ci=parse(await readFile('.github/workflows/ci.yml','utf8'));
 const deploy=parse(await readFile('.github/workflows/deploy-cloudflare.yml','utf8'));
 assert.ok(ci.on.pull_request!==undefined);
 assert.ok(deploy.on.workflow_dispatch);
 assert.equal(deploy.on.push,undefined);
 assert.equal(deploy.jobs.deploy.environment,'production');
 assert.match(deploy.jobs.deploy.if,/arena\/037de605-nounarchive/);
 assert.equal(deploy.concurrency['cancel-in-progress'],false);
 assert.equal(deploy.permissions.contents,'read');
 assert.ok(deploy.jobs.deploy.steps.some(step=>step.run==='npm test'));
});
test('Cloudflare targets share D1 binding and migration path',async()=>{
 const configs=await Promise.all(['wrangler.jsonc','wrangler.pages.jsonc','wrangler.scheduler.jsonc'].map(async file=>JSON.parse(await readFile(file,'utf8'))));
 const [worker,pages,scheduler]=configs;
 for(const c of configs){assert.equal(c.d1_databases[0].binding,'DB');assert.equal(c.d1_databases[0].database_id,worker.d1_databases[0].database_id);assert.ok(c.compatibility_flags.includes('nodejs_compat'));await readFile(c.d1_databases[0].migrations_dir+'/0001_initial.sql');}
 assert.equal(pages.triggers,undefined);
 assert.deepEqual(worker.triggers.crons,scheduler.triggers.crons);
});
