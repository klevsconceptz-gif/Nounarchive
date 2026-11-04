import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStorage} from '../storage.js';
test('database imports legacy data once, persists across reopen, and backs up',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nounarchive-db-'));let store;
 try{
 const filename=join(dir,'archive.sqlite'), archivePath=join(dir,'archive.json'),postsPath=join(dir,'posts.json');
 const item={id:'a1',source:'puredu',publishedAt:null,title:'A verified title'};
 await writeFile(archivePath,JSON.stringify({items:[item],status:{puredu:{state:'ok'}}}));await writeFile(postsPath,'[]');
 store=openStorage(filename);store.initialize({archivePath,postsPath});assert.equal(store.stats().articles,1);
 store.savePosts([{id:'p1',status:'draft',updatedAt:'2026-10-31',title:'Private draft'}]);
 // Duplicate IDs fail inside a transaction without destroying the saved archive.
 assert.throws(()=>store.saveArchive({items:[item,item],status:{}}));assert.equal(store.loadArchive().items.length,1);
 assert.equal(store.applyAdminReset('test-hash','test-base','used-token',Date.now()+900000),true);
 await store.backup(join(dir,'backup.sqlite'));store.close();store=null;
 await writeFile(archivePath,JSON.stringify({items:[],status:{}}));
 store=openStorage(filename);store.initialize({archivePath,postsPath});assert.equal(store.getAdminCredential().password_hash,'test-hash');assert.equal(store.applyAdminReset('replacement','test-base','used-token',Date.now()+900000),false);assert.equal(store.getAdminCredential().password_hash,'test-hash');assert.equal(store.loadArchive().items.length,1);assert.equal(store.loadPosts()[0].title,'Private draft');assert.equal(store.health(),true);store.close();store=null;
 const backup=openStorage(join(dir,'backup.sqlite'));assert.equal(backup.loadPosts().length,1);backup.close();
 }finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
