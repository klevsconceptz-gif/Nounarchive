import 'dotenv/config';
import {mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {openStorage} from '../storage.js';
const target=process.argv[2];
if(!target){console.error('Usage: npm run db:backup -- data/backups/archive.sqlite');process.exit(1);}
if(resolve(target)===resolve(process.env.DATABASE_PATH||'data/nounarchive.sqlite'))throw Error('Backup destination must differ from the live database.');
const storage=openStorage();
try{await mkdir(dirname(resolve(target)),{recursive:true});await storage.backup(target);console.log('Database backup completed.');}finally{storage.close();}
