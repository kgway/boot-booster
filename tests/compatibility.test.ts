import {test} from 'node:test';import assert from 'node:assert/strict';
import {CompatibilityControl,supportsAndroidAdapter,compatibleInventory} from '../src/compatibility';
function store(){const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};}
test('1.15.0 is supported while future versions require explicit consent',()=>{
 assert.equal(supportsAndroidAdapter('1.15.0'),true);assert.equal(supportsAndroidAdapter('9.9.9'),false);assert.equal(supportsAndroidAdapter('9.9.9',true),true);
 for(const api of ['','next','1.15','1.15.0-beta','1.15.0/path'])assert.equal(supportsAndroidAdapter(api,true),false);
 assert.equal(compatibleInventory('1.14.4','1.15.0'),true);assert.equal(compatibleInventory('9.9.8','1.15.0'),false);assert.equal(compatibleInventory('1.15.0','9.9.9',true),true);
});
test('unknown-version prompts appear once per version and only for Android optimization',()=>{
 const s=store(),c=new CompatibilityControl('9.9.9',s,'vault');assert.equal(c.shouldPrompt(true,true),true);
 assert.equal(c.shouldPrompt(false,true),false);assert.equal(c.shouldPrompt(true,false),false);c.prompted();
 assert.equal(new CompatibilityControl('9.9.9',s,'vault').shouldPrompt(true,true),false);
 assert.equal(new CompatibilityControl('9.9.10',s,'vault').shouldPrompt(true,true),true);
 assert.equal(c.allowed,false);assert.equal(new CompatibilityControl('1.15.0',s,'vault').shouldPrompt(true,true),false);
});
test('accepting one version does not opt another version or device into unknown versions',()=>{
 const s=store(),c=new CompatibilityControl('9.9.9',s,'one');c.accept();assert.equal(c.policy,'accepted');
 assert.equal(new CompatibilityControl('9.9.9',s,'one').allowed,true);assert.equal(new CompatibilityControl('9.9.10',s,'one').allowed,false);
 assert.equal(new CompatibilityControl('9.9.9',s,'two').allowed,false);
});
test('automatic consent suppresses prompts after updates and disabling it revokes the opt-in',()=>{
 const s=store(),c=new CompatibilityControl('9.9.9',s,'vault');c.accept();c.setAutomatic(true);
 const next=new CompatibilityControl('9.9.10',s,'vault');assert.equal(next.policy,'automatic');assert.equal(next.shouldPrompt(true,true),false);
 next.setAutomatic(false);assert.equal(next.allowed,false);assert.equal(new CompatibilityControl('9.9.9',s,'vault').allowed,false);
});
test('malformed and unavailable consent storage cannot grant permission',()=>{
 const s=store();s.data.set('boot-booster:compatibility:v1:vault','{"automatic":"true","acceptedApi":9}');assert.equal(new CompatibilityControl('9.9.9',s,'vault').allowed,false);
 const failed={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}};const c=new CompatibilityControl('9.9.9',failed,'vault');
 assert.throws(()=>c.accept(),/denied/);assert.equal(c.allowed,false);assert.throws(()=>c.setAutomatic(true),/denied/);assert.equal(c.allowed,false);
});
