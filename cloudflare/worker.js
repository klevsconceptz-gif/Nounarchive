import {api,syncSources} from './api.js';
export default {
 fetch(request,env,ctx){return new URL(request.url).pathname.startsWith('/api/')?api.fetch(request,env,ctx):env.ASSETS.fetch(request);},
 scheduled(event,env,ctx){ctx.waitUntil(syncSources(env));}
};
