import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';
test('GitHub workflows parse and production deployment supports main and the active branch',async()=>{
 const ci=parse(await readFile('.github/workflows/ci.yml','utf8'));
 const deploy=parse(await readFile('.github/workflows/deploy-cloudflare.yml','utf8'));
 assert.ok(ci.on.pull_request!==undefined);
 assert.ok(deploy.on.workflow_dispatch);
 assert.deepEqual(deploy.on.push.branches,['main']);
 assert.ok(deploy.jobs.deploy.if.includes("refs/heads/main"));
 assert.equal(deploy.jobs.deploy.steps[0].with.ref,'${{ github.sha }}');
 assert.equal(deploy.jobs.deploy.environment,'production');
 assert.match(deploy.jobs.deploy.if,/arena\/bf9d8ef8-nounarchive/);
 assert.equal(deploy.concurrency['cancel-in-progress'],false);
 assert.equal(deploy.permissions.contents,'read');
 assert.ok(deploy.jobs.deploy.steps.some(step=>step.run==='npm test'));
 const validation=deploy.jobs.deploy.steps.find(step=>step.name==='Validate deployment settings');
 // Extract and execute the exact hash-validation expression embedded in the workflow.
 const hashLine=validation.run.split('\n').find(line=>line.includes('pbkdf2-sha256'));
 const literal=hashLine.split('if (!')[1].split('.test(process.env.ADMIN_PASSWORD_HASH)')[0];
 const pattern=new Function('return '+literal)();
 assert.ok(pattern.test('pbkdf2-sha256$100000$'+'a'.repeat(64)+'$'+'b'.repeat(64)));
 assert.ok(!pattern.test('not-a-valid-hash'));
 const steps=deploy.jobs.deploy.steps.filter(step=>step.name?.includes('secret'));
 assert.equal(steps.length,2);
 for(const step of steps) assert.ok(step.run.includes('secret put ADMIN_PASSWORD_HASH'));
});
test('Cloudflare targets share D1 binding and migration path',async()=>{
 const configs=await Promise.all(['wrangler.jsonc','wrangler.pages.jsonc','wrangler.scheduler.jsonc'].map(async file=>JSON.parse(await readFile(file,'utf8'))));
 const [worker,pages,scheduler]=configs;
 for(const c of configs){assert.equal(c.d1_databases[0].binding,'DB');assert.equal(c.d1_databases[0].database_id,worker.d1_databases[0].database_id);assert.ok(c.compatibility_flags.includes('nodejs_compat'));await readFile(c.d1_databases[0].migrations_dir+'/0001_initial.sql');}
 assert.equal(pages.triggers,undefined);
 assert.deepEqual(worker.triggers.crons,scheduler.triggers.crons);
});

test('every workflow action reference is pinned to a full commit SHA',async()=>{
 const {readdir}=await import('node:fs/promises');
 for(const name of await readdir('.github/workflows')){
 if(!/\.ya?ml$/.test(name))continue;
 const workflow=parse(await readFile('.github/workflows/'+name,'utf8'));
 for(const job of Object.values(workflow.jobs||{})){
 const references=[job.uses,...(job.steps||[]).map(step=>step.uses)].filter(Boolean);
 for(const ref of references){if(ref.startsWith('./'))continue;assert.match(ref,/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,'Unpinned action in '+name+': '+ref);}
 }
 }
});
