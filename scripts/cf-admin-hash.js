import {createInterface} from 'node:readline/promises';
import {passwordKey,randomToken} from '../cloudflare/security.js';
if(!process.stdin.isTTY){console.error('Run in an interactive terminal. Never pass a password as a command-line argument.');process.exit(1);}
const rl=createInterface({input:process.stdin,output:process.stdout});
async function secret(prompt){process.stdout.write(prompt);rl._writeToOutput=()=>{};try{return await rl.question('');}finally{delete rl._writeToOutput;process.stdout.write('\n');}}
const password=await secret('Cloudflare admin password (12+ characters): ');const confirmation=await secret('Confirm password: ');rl.close();
if(password.length<12||password.length>1024||password!==confirmation){console.error('Passwords must match and contain 12–1024 characters.');process.exit(1);}
const salt=randomToken();console.log('Store the following value as ADMIN_PASSWORD_HASH via wrangler secret put or the Cloudflare dashboard. Treat it as a secret.');console.log(`pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`);
