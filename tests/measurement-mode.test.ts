import {test} from 'node:test';import assert from 'node:assert/strict';
// Verify product modes and legacy settings do not alter native plugin loading.
test('measurement-only mode observes startup but installs neither Vault nor plugin optimization',async()=>{
  const Module=require('node:module'),original=Module._load,disposers:(()=>void)[]=[],commands:any[]=[];
  class Plugin {app:any;manifest={version:'1.5.0'};async loadData(){return {version:2,scope:{all:true,folders:[]},startup:{plugins:'auto',selected:[],workspace:true}};}register(fn:()=>void){disposers.push(fn);}registerEvent(){}registerDomEvent(){}addCommand(c:any){commands.push(c);return c;}addSettingTab(){} }
  Module._load=function(id:string,...args:any[]){if(id==='obsidian')return {getLanguage:()=> 'ja',Plugin,Modal:class{},PluginSettingTab:class{},WorkspaceLeaf:class{},Platform:{isAndroidApp:true,isMobile:true},apiVersion:'1.14.4'};return original.call(this,id,...args);};
  let Boot:any;try{Boot=require('../src/main').default;}finally{Module._load=original;}
  const root='mode-test',data=new Map([['boot-booster:measurement:preferences:v1:'+root,JSON.stringify({enabled:true,mode:'measurement-only',label:''})],['boot-booster:fast-enabled:'+root,'always']]);
  (globalThis as any).window=globalThis;(globalThis as any).document={visibilityState:'visible'};(globalThis as any).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
  let preloads=0;const p=new Boot();p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=>root}},workspace:{layoutReady:false,onLayoutReady(){}},metadataCache:{fileCache:{},metadataCache:{},_preload(){},preload(){preloads++;return Promise.resolve();}},plugins:{enabledPlugins:new Set(),manifests:{},plugins:{}}};
  try{await p.onload();assert.equal(preloads,0);assert.equal(p.fastStart,null);assert.equal(p.startup,null);assert.equal(p.fastMode,'always');assert.equal(p.settings.startup.workspace,true);assert.equal(p.measurement.run.configuration.optimizationEnabled,false);assert.equal(p.measurement.run.condition.mode,'measurement-only');assert.ok(commands.some(c=>c.id==='startup-measurements'));}finally{p.onunload();disposers.reverse().forEach(fn=>fn());}
});

test('optimized onload ignores old scheduling flags and never reorders or saves enabled plugins',async()=>{
 const Boot=require('../src/main').default,root='native-order-test',data=new Map<string,string>([['boot-booster:measurement:preferences:v1:'+root,JSON.stringify({enabled:false,mode:'optimized',label:''})],['boot-booster:fast-enabled:'+root,'off']]);
 (globalThis as any).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
 const enabled=new Set(['first','boot-booster','last']),manager={enabledPlugins:enabled,manifests:{},plugins:{},loadPlugin:()=>{},enablePlugin:()=>{},disablePlugin:()=>{},saveConfig:()=>{throw Error('must not save');}},native={...manager};
 const p=new Boot(),registered:(()=>void)[]=[];p.register=(fn:()=>void)=>registered.push(fn);
 p.loadData=async()=>({version:2,scope:{all:true,folders:[]},startup:{workspace:true,plugins:'selected',selected:['last'],immediate:['first'],first:true}});
 const ready:(()=>void)[]=[];p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=>root},on:()=>({})},workspace:{layoutReady:false,onLayoutReady:(fn:()=>void)=>ready.push(fn),on:()=>({}),offref(){},async readWorkspaceFile(){return {};},iterateAllLeaves(){}},metadataCache:{},plugins:manager};
 const pluginPrototype=Object.getPrototypeOf(Boot.prototype),descriptors=Object.getOwnPropertyDescriptors(pluginPrototype);
 try{await p.onload();assert.ok(p.startup);assert.deepEqual(p.settings.startup,{workspace:true});
   for(const key of Object.keys(native))assert.equal(manager[key as keyof typeof manager],native[key as keyof typeof native]);assert.deepEqual([...enabled],['first','boot-booster','last']);
   assert.deepEqual(Object.getOwnPropertyDescriptors(pluginPrototype),descriptors);assert.equal(p.diagnosticReport().startup.pluginLoading,'native');
 }finally{p.onunload();registered.reverse().forEach(fn=>fn());}
});

test('unloading while settings are loading cannot install optimizers or hooks afterward',async()=>{
 const Boot=require('../src/main').default,root='unload-test',data=new Map<string,string>([['boot-booster:measurement:preferences:v1:'+root,JSON.stringify({enabled:false,mode:'optimized',label:''})],['boot-booster:fast-enabled:'+root,'always']]);
 (globalThis as any).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v),removeItem:(k:string)=>data.delete(k)};
 let finish!:(v:any)=>void,preloads=0;const p=new Boot();p.loadData=()=>new Promise(resolve=>{finish=resolve;});
 p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=>root}},workspace:{layoutReady:false,onLayoutReady(){}},metadataCache:{fileCache:{},metadataCache:{},_preload(){},preload(){preloads++;return Promise.resolve();}},plugins:{enabledPlugins:new Set(),manifests:{},plugins:{}}};
 const loading=p.onload();p.onunload();finish(null);await loading;
 assert.equal(preloads,0);assert.equal(p.fastStart,null);assert.equal(p.startup,null);
 await assert.rejects(p.scheduler.idle(),/stopped/);
});

test('product promotes only itself after layout while keeping the current startup untouched',async()=>{
 const Boot=require('../src/main').default,root='first-product',data=new Map<string,string>([['boot-booster:measurement:preferences:v1:'+root,JSON.stringify({enabled:false,mode:'optimized'})],['boot-booster:fast-enabled:'+root,'off']]);
 (globalThis as any).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)};
 const set=new Set(['one','boot-booster','two']),ready:(()=>void)[]=[],cleanup:(()=>void)[]=[];let saves=0;
 const p=new Boot();p.manifest={id:'boot-booster',version:'test'};p.register=(fn:()=>void)=>cleanup.push(fn);
 p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=>root}},workspace:{layoutReady:false,onLayoutReady:(fn:()=>void)=>ready.push(fn)},metadataCache:{},plugins:{enabledPlugins:set,manifests:{},async saveConfig(){saves++;}}};
 p.loadData=async()=>({version:2,scope:{all:true,folders:[]},startup:{workspace:false}});
 try{await p.onload();assert.deepEqual([...set],['one','boot-booster','two']);assert.equal(saves,0);
  p.app.workspace.layoutReady=true;ready.forEach(fn=>fn());await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual([...set],['boot-booster','one','two']);assert.equal(saves,1);
 }finally{p.onunload();cleanup.reverse().forEach(fn=>fn());}
});

test('first enable in an open Vault waits for native enablement before saving its own first position',async()=>{
 const Boot=require('../src/main').default,root='fresh-enable',data=new Map<string,string>([['boot-booster:measurement:preferences:v1:'+root,JSON.stringify({enabled:false,mode:'optimized'})],['boot-booster:fast-enabled:'+root,'off']]);
 (globalThis as any).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)};
 const set=new Set(['one','two']),cleanup:(()=>void)[]=[];let saves=0;
 const p=new Boot();p.manifest={id:'boot-booster',version:'test'};p.register=(fn:()=>void)=>cleanup.push(fn);
 p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=>root}},workspace:{layoutReady:true,onLayoutReady:(fn:()=>void)=>fn()},metadataCache:{},plugins:{enabledPlugins:set,manifests:{},async saveConfig(){saves++;}}};
 p.loadData=async()=>({version:2,scope:{all:true,folders:[]},startup:{workspace:false}});
 try{await p.onload();assert.equal(saves,0);set.add('boot-booster');await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual([...set],['boot-booster','one','two']);assert.equal(saves,1);
 }finally{p.onunload();cleanup.reverse().forEach(fn=>fn());}
});
