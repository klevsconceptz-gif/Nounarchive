import {randomToken,digest} from '../cloudflare/security.js';
if(!process.stdout.isTTY){console.error('Run in an interactive terminal. Recovery credentials must not be written to build logs or redirected into files.');process.exit(1);}
const token=randomToken(),expires=Date.now()+15*60*1000;
console.log('Owner-assisted admin recovery. Expires at '+new Date(expires).toISOString());
console.log('1. Configure ADMIN_RESET_TOKEN_HASH as a private runtime secret (not a public/build variable):');
console.log(`${expires}$${await digest(token)}`);
console.log('2. Open /admin.html, choose Reset password, and enter this one-time recovery token:');
console.log(token);
console.log('Never share either value in chat, URLs, Git, or CI logs. Remove the runtime secret after use.');
