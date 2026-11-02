import {test} from 'node:test';
import assert from 'node:assert/strict';
import {passwordHash,verifyPassword,validatePost} from '../admin.js';
test('password hashes are salted and validated',()=>{const hash=passwordHash('a very long test password');assert.equal(verifyPassword('a very long test password',hash),true);assert.equal(verifyPassword('incorrect',hash),false);assert.equal(verifyPassword(null,hash),false);assert.notEqual(passwordHash('a very long test password').salt,hash.salt);});
test('validates and normalizes editorial posts',()=>{const result=validatePost({title:'  A useful student update  ',content:'A sufficiently long piece of news for students.',excerpt:'',category:'Academics',status:'draft'});assert.equal(result.title,'A useful student update');assert.equal(result.excerpt,result.content);});
test('rejects invalid post input',()=>{assert.throws(()=>validatePost({}));assert.throws(()=>validatePost({title:'Valid title',content:'a'.repeat(30),category:'Fake',status:'published'}));assert.throws(()=>validatePost({title:'Valid title',content:'a'.repeat(30),category:'Academics',status:'secret'}));});
