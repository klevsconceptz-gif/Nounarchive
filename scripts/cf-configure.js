import {readFile,writeFile} from 'node:fs/promises';
const paths=['wrangler.jsonc','wrangler.pages.jsonc','wrangler.scheduler.jsonc'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const argument=process.argv[2];
const checking=argument==='--check';
const value=checking?process.env.D1_DATABASE_ID:argument;
const configs=await Promise.all(paths.map(async path=>({path,config:JSON.parse(await readFile(path,'utf8'))})));
if(value!==undefined){
 if(!uuid.test(value))throw Error('Invalid D1_DATABASE_ID. Use the actual database UUID from Cloudflare Storage & databases > D1 > nounarchive, not the database name or account ID.');
 for(const {config} of configs)for(const binding of config.d1_databases||[])if(binding.binding==='DB')binding.database_id=value;
}else if(!checking){
 throw Error('Usage: npm run cf:configure -- <actual D1 database UUID>');
}
for(const {path,config} of configs){
 const binding=config.d1_databases?.find(binding=>binding.binding==='DB');
 if(!binding||!uuid.test(binding.database_id||''))throw Error(`D1 is not configured in ${path}. Set the D1_DATABASE_ID build variable and deploy with npm run cf:deploy, or run npm run cf:configure -- <actual database UUID>. Dashboard bindings do not replace the ID in Wrangler configuration.`);
}
// Validate every configuration before writing any of them.
if(value!==undefined){
 for(const {path,config} of configs)await writeFile(path,JSON.stringify(config,null,2)+'\n');
 console.log('D1 binding configured for Worker, Pages and scheduler.');
}else console.log('D1 configuration is valid.');
