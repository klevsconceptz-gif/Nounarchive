import {api} from '../../cloudflare/api.js';
export const onRequest = context => api.fetch(context.request,context.env,context);
