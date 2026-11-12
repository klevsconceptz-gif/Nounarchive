import {sources,collect} from './aggregator.js';
export const REFRESH_MS=24*60*60*1000;
export function mergeArticle(previous,incoming,checkedAt){
 return {...previous,...incoming,publishedAt:incoming.publishedAt||previous?.publishedAt||null,excerpt:incoming.excerpt||previous?.excerpt||'',verifiedAt:checkedAt};
}
// Keep historical records and the last successful check when a provider fails.
// Return a new archive so a failed persistence operation cannot mutate the live view.
export async function refreshArchive(archive,collector=collect,clock=()=>new Date().toISOString()){
 const items=new Map((archive.items||[]).map(item=>[item.id,item]));
 const status={...archive.status};
 for(const source of sources){
 const checkedAt=clock();
 try{
 const incoming=await collector(source);
 if(!incoming.length)throw Error('No articles found.');
 for(const item of incoming)items.set(item.id,mergeArticle(items.get(item.id),item,checkedAt));
 status[source.id]={state:'ok',checkedAt,lastSuccess:checkedAt,message:`${incoming.length} articles found`};
 }catch(error){status[source.id]={...status[source.id],state:'error',checkedAt,message:error.message};}
 }
 return {...archive,items:[...items.values()],status};
}
