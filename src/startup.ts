import {App,Platform,apiVersion} from 'obsidian';
import {IdleScheduler} from './scheduler';
import {StartupSettings} from './policy';
import {deferWorkspace,labelKey,ViewLabel} from './workspace-startup';
import {supportsAndroidAdapter} from './compatibility';
import {patchMethods} from './method-patch';
import {record,isMethod,parseJSON} from './runtime';

/** Workspace display hints only. Never wrap or call the plugin manager. */
export class WorkspaceOptimizer {
  private stopped=false;private disposers:(()=>void)[]=[];
  private labels:Record<string,ViewLabel>={};private dirty=false;private saving=false;
  private key:string;hinted=0;reason='';
  constructor(private app:App,private settings:StartupSettings,private scheduler:IdleScheduler){
    this.key=`boot-booster:workspace:v1:${apiVersion}:${app.vault.adapter.getResourcePath('')}`;
  }
  install():void{
    if(this.stopped||this.disposers.length)return;
    const w=record(this.app.workspace),original=w.readWorkspaceFile;
    if(!this.settings.workspace||!Platform.isAndroidApp||!supportsAndroidAdapter(apiVersion)||!isMethod(original)){
      this.reason='Native workspace restoration';return;
    }
    try{const data=record(parseJSON(window.localStorage.getItem(this.key)||'null'));if(data.version===1)
      for(const [key,value] of Object.entries(record(data.labels))){const v=record(value);if(typeof v.icon==='string'&&typeof v.title==='string')this.labels[key]={icon:v.icon,title:v.title};}
    }catch{/* Optional display hints. */}
    let enabled=true;
    const read=async(receiver:unknown,args:unknown[])=>{const layout=await original.apply(receiver,args);
      if(!enabled||this.stopped||record(receiver).layoutReady)return layout;
      try{const registry=record(record(this.app).viewRegistry),creator=registry.getViewCreatorByType;
        const result=deferWorkspace(layout,this.labels,type=>isMethod(creator)&&!!creator.call(registry,type));
        this.hinted+=result.hinted;return result.layout;
      }catch{return layout;}
    };
    const undo=patchMethods([{host:w,name:'readWorkspaceFile',replacement:function(this:unknown,...args:unknown[]){return read(this,args);}}]);
    if(!undo){this.reason='Native workspace restoration';return;}
    this.disposers.push(()=>{enabled=false;undo();});
    let timer:number|undefined;
    try{
      const ref=this.app.workspace.on('layout-change',()=>{if(enabled&&w.layoutReady&&!this.stopped){window.clearTimeout(timer);timer=window.setTimeout(()=>{timer=undefined;this.captureLabels();},1000);}});
      this.disposers.push(()=>{window.clearTimeout(timer);this.app.workspace.offref(ref);});
      this.app.workspace.onLayoutReady(()=>{if(enabled&&!this.stopped)this.captureLabels();});
    }catch{for(const dispose of this.disposers.reverse())dispose();this.disposers=[];this.reason='Native workspace restoration';return;}
    this.reason='Reusing workspace view metadata';
  }
  private captureLabels():void{
    if(this.stopped)return;
    const labels:Record<string,ViewLabel>={};
    try{this.app.workspace.iterateAllLeaves(leaf=>{const state=record(leaf.getViewState());if(typeof state.icon==='string'&&typeof state.title==='string')labels[labelKey(state)]={icon:state.icon,title:state.title};});}
    catch{return;}
    if(JSON.stringify(labels)===JSON.stringify(this.labels))return;
    this.labels=labels;this.dirty=true;if(this.saving)return;this.saving=true;
    void this.scheduler.idle().then(()=>this.checkpoint(),()=>{}).finally(()=>{this.saving=false;});
  }
  checkpoint():boolean{
    if(this.stopped||!this.dirty)return false;
    try{window.localStorage.setItem(this.key,JSON.stringify({version:1,labels:this.labels}));this.dirty=false;return true;}catch{return false;}
  }
  diagnostics():object{return {reason:this.reason,hintedWorkspaceViews:this.hinted,pluginLoading:'native'};}
  dispose():void{this.checkpoint();this.stopped=true;for(const dispose of this.disposers.reverse())dispose();}
}
