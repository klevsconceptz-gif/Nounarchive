import {digest,randomToken} from './security.js';

const encoder=new TextEncoder();
const MAX_RECORD_BYTES=8_000;
const MAX_BATCH_RECORDS=1_000_000;
const MAX_CHUNK_RECORDS=50;
const bytesToBase64Url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decodeBase64Url(value){
 if(typeof value!=='string'||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid encrypted result data.');
 const normalized=value.replace(/-/g,'+').replace(/_/g,'/'),padding='='.repeat((4-normalized.length%4)%4);
 return Uint8Array.from(atob(normalized+padding),char=>char.charCodeAt(0));
}
function base64UrlToBytes(value){
 const bytes=decodeBase64Url(value);
 if(bytes.byteLength!==32)throw new Error('Student-results encryption is not configured.');
 return bytes;
}
async function encryptionKey(env,usage){
 let raw;try{raw=base64UrlToBytes(env.STUDENT_RESULTS_ENCRYPTION_KEY);}catch{throw new Error('Private student-results encryption is not configured.');}
 if(raw.byteLength!==32)throw new Error('Private student-results encryption is not configured.');
 return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,[usage]);
}
function resultAad(batchId,rowIndex,id){return encoder.encode(`nounarchive-student-result-v1:${batchId}:${rowIndex}:${id}`);}
export async function encryptStudentResult(record,batchId,rowIndex,env){
 const plain=JSON.stringify(record),plainBytes=encoder.encode(plain);
 if(plainBytes.byteLength>MAX_RECORD_BYTES)throw new Error(`Each result row must be ${MAX_RECORD_BYTES} bytes or smaller.`);
 const id=await digest(`${batchId}:${rowIndex}`),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await encryptionKey(env,'encrypt');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:resultAad(batchId,rowIndex,id)},key,plainBytes);
 return {id,iv:bytesToBase64Url(iv),ciphertext:bytesToBase64Url(new Uint8Array(ciphertext))};
}
export async function decryptStudentResult(row,env){
 const key=await encryptionKey(env,'decrypt');
 try{
  const iv=decodeBase64Url(row.iv),ciphertext=decodeBase64Url(row.ciphertext);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:resultAad(row.batch_id,row.row_index,row.id)},key,ciphertext);
  return JSON.parse(new TextDecoder().decode(bytes));
 }catch{throw new Error('A stored private result could not be decrypted. Check the configured encryption key.');}
}
export function validResultBatch(body){
 return body&&typeof body==='object'&&!Array.isArray(body)&&['csv','json'].includes(body.format)&&Number.isSafeInteger(body.totalRecords)&&body.totalRecords>0&&body.totalRecords<=MAX_BATCH_RECORDS;
}
export function validResultChunk(body,totalRecords){
 if(!body||typeof body!=='object'||Array.isArray(body)||!Number.isSafeInteger(body.offset)||body.offset<0||!Array.isArray(body.records)||body.records.length<1||body.records.length>MAX_CHUNK_RECORDS)return false;
 if(body.offset+body.records.length>totalRecords)return false;
 return body.records.every(record=>record&&typeof record==='object'&&!Array.isArray(record)&&encoder.encode(JSON.stringify(record)).byteLength<=MAX_RECORD_BYTES);
}
export function resultLimits(){return {maxRecordBytes:MAX_RECORD_BYTES,maxChunkRecords:MAX_CHUNK_RECORDS,maxBatchRecords:MAX_BATCH_RECORDS};}
export const createResultBatchId=()=>randomToken().slice(0,32);
