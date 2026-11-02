import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('dist/pages-site',{recursive:true});await cp('public','dist/pages-site',{recursive:true});
await cp('dist/pages/index.js','dist/pages-site/_worker.js');
const config=JSON.parse(await readFile('wrangler.pages.jsonc','utf8'));config.pages_build_output_dir='.';delete config.$schema;
// Staged directory is the Pages project root, separate from the standalone Worker configuration.
config.d1_databases[0].migrations_dir='../../cloudflare/migrations';
await writeFile('dist/pages-site/wrangler.jsonc',JSON.stringify(config,null,2));
console.log('Pages artifact ready in dist/pages-site (advanced-mode Worker + static assets).');
