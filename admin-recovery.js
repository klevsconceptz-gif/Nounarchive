import {digest,passwordKey,randomToken} from './cloudflare/security.js';
export const HASH_PATTERN=/^pbkdf2-sha256\$100000\$[a-f0-9]{64}\$[a-f0-9]{64}$/;
export const CLAIM_RESET_SQL='INSERT OR IGNORE INTO admin_reset_tokens(token_hash,expires) VALUES(?,?)';
// Must immediately follow CLAIM_RESET_SQL in the same transaction/DB.batch.
export const SAVE_RESET_SQL=`INSERT INTO admin_credentials(id,password_hash,base_version) SELECT 1,?,? WHERE changes()=1 ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,base_version=excluded.base_version`;
export function validNewPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=1024;}
export async function makePasswordHash(password){const salt=randomToken();return `pbkdf2-sha256$100000$${salt}$${await passwordKey(password,salt)}`;}
export async function checkRecoveryToken(token,configuration,now=Date.now()){
 const match=/^(\d{13})\$([a-f0-9]{64})$/.exec(configuration||'');
 if(!match||Number(match[1])<=now||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
 const hash=await digest(token);let difference=0;for(let i=0;i<64;i++)difference|=hash.charCodeAt(i)^match[2].charCodeAt(i);
 return difference?null:{hash,expires:Number(match[1])};
}
