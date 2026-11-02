import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { passwordHash } from '../admin.js';
if(!process.stdin.isTTY) { console.error('Run this command in an interactive terminal, or configure ADMIN_PASSWORD in your hosting environment.'); process.exit(1); }
try { await access('data/admin-credential.json'); if(!process.argv.includes('--reset')) {console.error('Admin already configured. Use npm run admin:setup -- --reset to replace the password.');process.exit(1);} } catch {}
const rl=createInterface({input:process.stdin,output:process.stdout});
// Mute terminal echo for password entry.
function secret(prompt){ process.stdout.write(prompt); rl._writeToOutput=()=>{}; return rl.question('').finally(()=>{delete rl._writeToOutput;process.stdout.write('\n');}); }
const password=await secret('New admin password (12+ characters): ');
const confirmation=await secret('Confirm password: ');rl.close();
if(password.length<12 || password.length>1024 || password!==confirmation){console.error('Passwords must match and contain 12–1024 characters.');process.exit(1);}
await mkdir('data',{recursive:true});await writeFile('data/admin-credential.json',JSON.stringify(passwordHash(password)),{mode:0o600});
console.log('Admin password configured. Restart the server, then visit /admin.html.');
