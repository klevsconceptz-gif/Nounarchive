import 'dotenv/config';
import {openStorage} from '../storage.js';
import {sources,resourceSources} from '../aggregator.js';
import {refreshArchive} from '../news-sync.js';
import {refreshResourceArchive} from '../resource-sync.js';

const storage=openStorage();
try{
 storage.initialize();
 const [archive,resources]=await Promise.all([
  refreshArchive(storage.loadArchive()),
  refreshResourceArchive(storage.loadResources())
 ]);
 storage.saveArchive(archive);
 storage.saveResources(resources);
 for(const source of sources){const result=archive.status[source.id];console.log(`${source.name} news: ${result.state} — ${result.message} (${result.checkedAt})`);}
 for(const source of resourceSources){const result=resources.status[source.id];console.log(`${source.name} tools/resources: ${result.state} — ${result.message} (${result.checkedAt})`);}
 console.log('Stored news:',archive.items.length,'· tools/resources:',resources.items.length);
 if(sources.some(source=>archive.status[source.id]?.state!=='ok')||resourceSources.some(source=>resources.status[source.id]?.state!=='ok'))process.exitCode=1;
}finally{storage.close();}
