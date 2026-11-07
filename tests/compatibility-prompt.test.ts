import {test} from 'node:test';import assert from 'node:assert/strict';
const Module=require('node:module'),original=Module._load;
const opened:any[]=[],buttons:any[]=[],notices:string[]=[];
class Modal {contentEl={createEl(){},empty(){}};titleEl={setText(){}};onOpen(){}onClose(){};open(){opened.push(this);this.onOpen();}close(){this.onClose();}}
class Setting {constructor(_el:unknown){}addButton(fn:(b:any)=>unknown){const b:any={setButtonText(text:string){this.text=text;return this;},setCta(){return this;},onClick(fn:()=>void){this.click=fn;return this;}};fn(b);buttons.push(b);return this;}}
class Plugin {app:any;manifest={id:'boot-booster',name:'Boot Booster',version:'test'};loadData=async()=>({version:2,scope:{all:true,folders:[]},startup:{workspace:false}});register=(_fn:()=>void)=>{};registerEvent(){}registerDomEvent(){}addCommand(c:unknown){return c;}addSettingTab(){} }
const obsidian={getLanguage:()=> 'ja',Plugin,Modal,Setting,Notice:class{constructor(text:string){notices.push(text);}},PluginSettingTab:class{},WorkspaceLeaf:class{},Platform:{isAndroidApp:true,isMobile:true},apiVersion:'9.9.9'};
Module._load=function(id:string,...args:unknown[]){return id==='obsidian'?obsidian:original.call(this,id,...args);};
let Boot:any;try{Boot=require('../src/main').default;}finally{Module._load=original;}
async function host(mode='optimized',automatic=false){
 opened.length=buttons.length=notices.length=0;
 const data=new Map<string,string>([['boot-booster:measurement:preferences:v1:lab',JSON.stringify({enabled:false,mode})],['boot-booster:fast-enabled:lab','always']]);
 if(automatic)data.set('boot-booster:compatibility:v1:lab',JSON.stringify({automatic:true}));
 const timers=new Map<number,()=>void>(),ready:(()=>void)[]=[],cleanup:(()=>void)[]=[];let id=0;
 (globalThis as any).window={localStorage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>data.set(k,v)},setTimeout:(fn:()=>void)=>{timers.set(++id,fn);return id;},clearTimeout:(id:number)=>timers.delete(id)};
 (globalThis as any).document={visibilityState:'visible'};
 const p=new Boot();p.register=(fn:()=>void)=>cleanup.push(fn);
 p.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=> 'lab'}},workspace:{layoutReady:false,onLayoutReady:(fn:()=>void)=>ready.push(fn)},metadataCache:{},plugins:{enabledPlugins:new Set(),manifests:{},plugins:{}}};
 await p.onload();return {p,data,ready,timers,cleanup,flush:()=>{const queued=[...timers.values()];timers.clear();queued.forEach(fn=>fn());}};
}
test('unknown-version prompt waits for layout and accepting it changes only the next startup decision',async()=>{
 const h=await host();assert.equal(opened.length,0);assert.equal(h.p.diagnosticReport().compatibility.allowed,false);
 h.ready.forEach(fn=>fn());h.flush();assert.equal(opened.length,1);assert.equal(buttons.length,2);
 buttons.find(b=>b.text==='この版で試す').click();assert.equal(h.p.compatibility.allowed,true);
 assert.equal(h.p.diagnosticReport().compatibility.allowed,false);assert.equal(h.p.fastStart.phase,'unsupported');assert.ok(notices.length);
 h.p.onunload();h.cleanup.reverse().forEach(fn=>fn());
});
test('automatic permission and normal measurement mode do not show version prompts',async()=>{
 for(const [mode,automatic] of [['optimized',true],['measurement-only',false]] as const){const h=await host(mode,automatic);h.ready.forEach(fn=>fn());h.flush();assert.equal(opened.length,0);h.p.onunload();h.cleanup.reverse().forEach(fn=>fn());}
});
test('unloading before the delayed prompt prevents it from opening',async()=>{
 const h=await host();h.ready.forEach(fn=>fn());h.p.onunload();h.cleanup.reverse().forEach(fn=>fn());h.flush();assert.equal(opened.length,0);
});
