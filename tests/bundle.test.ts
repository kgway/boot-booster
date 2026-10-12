import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

test('generated Android bundle can load, retain measurement-only mode and unload without filesystem hooks',async()=>{
 const root=resolve(__dirname,'../..'),source=readFileSync(resolve(root,'main.js'),'utf8');
 const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
 const callbacks:(()=>void)[]=[],commands:any[]=[];
 const data=new Map([['boot-booster:measurement:preferences:v1:bundle-test',JSON.stringify({enabled:false,mode:'measurement-only'})],['boot-booster:fast-enabled:bundle-test','always']]);
 const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)};
 class Plugin {
  app:any;manifest=manifest;
  async loadData(){return {version:2,scope:{all:true,folders:[]},startup:{workspace:true,pluginFiles:true}};}
  register(fn:()=>void){callbacks.push(fn);}registerEvent(){}registerDomEvent(){}
  addCommand(value:any){commands.push(value);return value;}addSettingTab(){}
 }
 const obsidian={getLanguage:()=> 'en',Plugin,Modal:class{},PluginSettingTab:class{},WorkspaceLeaf:class{},Platform:{isAndroidApp:true,isMobile:true},apiVersion:'1.14.4'};
 const context:any={module:{exports:{}},require:(name:string)=>{assert.equal(name,'obsidian');return obsidian;},
  localStorage:storage,window:{localStorage:storage,clearInterval,setInterval},setTimeout,clearTimeout,performance,console};
 runInNewContext(source,context,{timeout:1000});
 const Boot=context.module.exports.default;assert.equal(typeof Boot,'function');
 const fs={read:()=>{throw Error('unexpected filesystem access');}},enabled=new Set(['one','boot-booster','two']);
 const plugin=new Boot();plugin.app={vault:{configDir:'.obsidian',adapter:{getResourcePath:()=> 'bundle-test',fs}},
  workspace:{layoutReady:true,onLayoutReady(){throw Error('unexpected optimization');}},metadataCache:{},
  plugins:{enabledPlugins:enabled,saveConfig(){throw Error('unexpected config write');}}};
 try{await plugin.onload();assert.equal(plugin.fastStart,null);assert.equal(plugin.pluginFiles,null);assert.equal(plugin.startup,null);
  assert.equal(plugin.diagnosticReport().measurementMode,'measurement-only');assert.equal(plugin.fastMode,'always');
  assert.deepEqual([...enabled],['one','boot-booster','two']);assert.equal(commands.length,2);
 }finally{plugin.onunload();callbacks.reverse().forEach(fn=>fn());}
});
