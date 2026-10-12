import {test} from 'node:test';import assert from 'node:assert/strict';
const Module=require('node:module'),load=Module._load;
Module._load=function(id:string,...args:any[]){return id==='obsidian'?{Platform:{isAndroidApp:true},apiVersion:'1.14.4'}:load.call(this,id,...args);};
let Workspace:any;try{Workspace=require('../src/startup').WorkspaceOptimizer;}finally{Module._load=load;}
function fixture(enabled=true){
 const data=new Map<string,string>();(globalThis as any).localStorage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)};(globalThis as any).window=globalThis;
 const layout={active:'one',main:{type:'tabs',children:[{type:'leaf',id:'one',pinned:true,group:'group',state:{type:'markdown',state:{file:'note.md',mode:'source'}}},{type:'leaf',id:'two',state:{type:'unknown',state:{file:'plugin.data',value:9}}}]}};
 let reads=0;const ready:(()=>void)[]=[],events=new Map<string,()=>void>();
 const manager={enabledPlugins:new Set(['a','boot-booster','b']),loadPlugin:()=>{throw Error('native plugin loading only');},enablePlugin:()=>{},disablePlugin:()=>{},saveConfig:()=>{throw Error('must not save');}};
 const w={layoutReady:false,readWorkspaceFile:async function(arg:string){assert.equal(this,w);assert.equal(arg,'arg');reads++;return layout;},onLayoutReady:(fn:()=>void)=>ready.push(fn),on:(key:string,fn:()=>void)=>{events.set(key,fn);return key;},offref:(key:string)=>events.delete(key),iterateAllLeaves:(visit:any)=>visit({getViewState:()=>({type:'markdown',state:{file:'note.md'},icon:'icon',title:'note'})})};
 const app={workspace:w,plugins:manager,vault:{adapter:{getResourcePath:()=>'/test'}},viewRegistry:{getViewCreatorByType:(type:string)=>type==='markdown'}};
 const optimizer=new Workspace(app,{workspace:enabled,plugins:'selected',selected:['b'],first:true},{idle:async()=>{}});
 return {optimizer,manager,w,layout,data,reads:()=>reads,ready:()=>{w.layoutReady=true;ready.forEach(fn=>fn());}};
}
test('workspace hints preserve complete saved state without touching native plugin loading',async()=>{
 const f=fixture(),manager={...f.manager},order=[...f.manager.enabledPlugins],nativeRead=f.w.readWorkspaceFile;
 f.optimizer.install();const result=await f.w.readWorkspaceFile('arg');assert.equal(f.reads(),1);
 assert.equal(result.active,'one');assert.deepEqual(result.main.children[1],f.layout.main.children[1]);
 assert.deepEqual(result.main.children[0],f.layout.main.children[0]);
 assert.equal((f.layout.main.children[0].state as any).title,undefined);
 for(const key of Object.keys(manager))assert.equal((f.manager as any)[key],(manager as any)[key]);assert.deepEqual([...f.manager.enabledPlugins],order);
 f.ready();await Promise.resolve();await Promise.resolve();assert.equal(await f.w.readWorkspaceFile('arg'),f.layout);
 assert.equal(f.optimizer.diagnostics().pluginLoading,'native');assert.ok([...f.data.keys()].every(k=>k.includes(':workspace:')));
 f.optimizer.dispose();assert.equal(f.w.readWorkspaceFile,nativeRead);
});
test('disabled hints leave workspace and plugin manager methods unchanged',async()=>{
 const f=fixture(false),native=f.w.readWorkspaceFile;f.optimizer.install();assert.equal(f.w.readWorkspaceFile,native);assert.equal(await f.w.readWorkspaceFile('arg'),f.layout);assert.equal(f.data.size,0);f.optimizer.dispose();
});
test('storage failure and a later wrapper cannot be overwritten by cleanup',async()=>{
 const f=fixture();f.optimizer.install();const inside=f.w.readWorkspaceFile,later=(arg:string)=>inside.call(f.w,arg);f.w.readWorkspaceFile=later;
 (globalThis as any).localStorage.setItem=()=>{throw Error('denied');};assert.doesNotThrow(()=>f.ready());await Promise.resolve();
 assert.equal(f.optimizer.checkpoint(),false);f.optimizer.dispose();assert.equal(f.w.readWorkspaceFile,later);assert.equal(await f.w.readWorkspaceFile('arg'),f.layout);
});

test('an unsupported view registry cannot break normal workspace restoration',async()=>{
 const f=fixture();(f.optimizer as any).app.viewRegistry.getViewCreatorByType=()=>{throw Error('changed API');};
 f.optimizer.install();assert.equal(await f.w.readWorkspaceFile('arg'),f.layout);assert.equal(f.reads(),1);f.optimizer.dispose();
});

test('an unpatchable workspace reader leaves normal startup available',async()=>{
 const f=fixture(),native=f.w.readWorkspaceFile;Object.defineProperty(f.w,'readWorkspaceFile',{writable:false});
 assert.doesNotThrow(()=>f.optimizer.install());assert.equal(f.w.readWorkspaceFile,native);assert.equal(await f.w.readWorkspaceFile('arg'),f.layout);
 f.optimizer.dispose();assert.equal(f.data.size,0);
});

test('workspace event registration failure rolls back its read hook',()=>{
 const f=fixture(),native=f.w.readWorkspaceFile;f.w.on=()=>{throw Error('unavailable events');};
 assert.doesNotThrow(()=>f.optimizer.install());assert.equal(f.w.readWorkspaceFile,native);f.optimizer.dispose();
});
