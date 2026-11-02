import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const mode=process.argv[2];
if(!['deploy','dev'].includes(mode))throw Error('Expected dev or deploy.');
const args=mode==='deploy'?['--project-name','nounarchive']:['--ip','0.0.0.0','--persist-to',resolve('.wrangler/state')];
const result=spawnSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'pages',mode,'.',...args,...process.argv.slice(3)],{cwd:resolve('dist/pages-site'),stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
