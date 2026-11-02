import {syncSources} from './api.js';
export default {
 fetch(){return new Response('Nounarchive scheduled source collector. No public ingestion endpoint.',{status:404});},
 scheduled(event,env,ctx){ctx.waitUntil(syncSources(env));}
};
