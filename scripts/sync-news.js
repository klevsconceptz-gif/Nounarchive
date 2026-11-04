import 'dotenv/config';
import {openStorage} from '../storage.js';
import {sources} from '../aggregator.js';
import {refreshArchive} from '../news-sync.js';
const storage=openStorage();
try{
 storage.initialize();const archive=await refreshArchive(storage.loadArchive());storage.saveArchive(archive);
 for(const source of sources){const result=archive.status[source.id];console.log(`${source.name}: ${result.state} — ${result.message} (${result.checkedAt})`);}
 console.log('Stored articles:',archive.items.length);
 if(sources.some(source=>archive.status[source.id].state!=='ok'))process.exitCode=1;
}finally{storage.close();}
