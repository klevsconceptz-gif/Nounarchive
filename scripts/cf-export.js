import 'dotenv/config';
import {access,writeFile} from 'node:fs/promises';
import {openStorage} from '../storage.js';
const filename=process.env.DATABASE_PATH||'data/nounarchive.sqlite';await access(filename);
const store=openStorage(filename),output=process.argv[2]||'data/cloudflare-export.sql';
const quote=value=>value==null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
try{
 const archive=store.loadArchive(),posts=store.loadPosts(),lines=['-- Private export: may contain unpublished drafts. Existing D1 rows are preserved.'];
 for(const item of archive.items)lines.push(`INSERT OR IGNORE INTO articles(id,source,published_at,data) VALUES(${[item.id,item.source,item.publishedAt,JSON.stringify(item)].map(quote).join(',')});`);
 for(const [source,status] of Object.entries(archive.status||{}))lines.push(`INSERT OR IGNORE INTO source_status(source,data) VALUES(${quote(source)},${quote(JSON.stringify(status))});`);
 for(const p of posts)lines.push(`INSERT OR IGNORE INTO posts(id,status,published_at,updated_at,data) VALUES(${[p.id,p.status,p.publishedAt,p.updatedAt,JSON.stringify(p)].map(quote).join(',')});`);
 await writeFile(output,lines.join('\n')+'\n',{mode:0o600});console.log('Private SQL export written. Import using wrangler d1 execute nounarchive --remote --file <path>.');
}finally{store.close();}
