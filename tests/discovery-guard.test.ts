import {test} from 'node:test';
import assert from 'node:assert/strict';
const Module=require('node:module'),load=Module._load;
class File {constructor(public path:string){}}
let protect:typeof import('../src/discovery-guard').protectDiscoveredNotes;
try {
  Module._load=function(id:string,...args:unknown[]){return id==='obsidian'?{TFile:File}:load.call(this,id,...args);};
  protect=require('../src/discovery-guard').protectDiscoveredNotes;
} finally {Module._load=load;}
const appWith=(owner:object)=>({plugins:{plugins:{'templater-obsidian':{templater:{constructor:owner}}}}}) as never;

test('discovery guard skips only recognized existing files and preserves native calls and restoration',async()=>{
  const calls:unknown[][]=[];
  const owner={on_file_creation:function(this:unknown,...args:unknown[]){calls.push([this,...args]);return Promise.resolve('native');}};
  const original=owner.on_file_creation,receiver={},file=new File('Archive/a.md');
  const guard=protect(appWith(owner),path=>path==='Archive/a.md');assert.ok(guard);
  assert.equal(await owner.on_file_creation.call(receiver,1,2,file),undefined);assert.equal(calls.length,0);
  assert.equal(await owner.on_file_creation.call(receiver,1,2,new File('Inbox/new.md')),'native');
  assert.equal(await owner.on_file_creation.call(receiver,1,2,{path:'Archive/a.md'}),'native');
  assert.equal(calls.length,2);assert.equal(calls[0][0],receiver);
  guard.dispose();assert.equal(owner.on_file_creation,original);
});

test('locked Templater discovery hook stops recognition without replacing the native method',()=>{
  const original=()=>Promise.resolve(),owner={};
  Object.defineProperty(owner,'on_file_creation',{value:original,writable:false,configurable:false});
  assert.throws(()=>protect(appWith(owner),()=>true),/protection unavailable/);
  assert.equal((owner as {on_file_creation:unknown}).on_file_creation,original);
});
