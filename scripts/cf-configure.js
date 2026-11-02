import {readFile,writeFile} from 'node:fs/promises';
const paths=['wrangler.jsonc','wrangler.pages.jsonc','wrangler.scheduler.jsonc'];
const value=process.argv[2];
if(value==='--check'){
 for(const path of paths){const config=JSON.parse(await readFile(path,'utf8'));if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(config.d1_databases[0].database_id))throw Error('Create a D1 database, then run npm run cf:configure -- <actual-database-id> before remote operations.');}
}else{
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value||''))throw Error('Usage: npm run cf:configure -- <actual D1 database UUID from wrangler d1 create>');
 for(const path of paths){const config=JSON.parse(await readFile(path,'utf8'));config.d1_databases[0].database_id=value;await writeFile(path,JSON.stringify(config,null,2)+'\n');}
 console.log('D1 binding configured for Worker, Pages and scheduler.');
}
