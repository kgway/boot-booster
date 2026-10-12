import { App, Notice, Platform, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, getLanguage } from 'obsidian';
import { defaults, parseSettings, Settings, StartupSettings } from './policy';
import { Scope, normalizeScope, scopeKey, validTarget } from './target';
import { FastStart } from './fast-start';
import { IdleScheduler } from './scheduler';
import { apiVersion } from 'obsidian';
import { protectDiscoveredNotes,templaterOwner } from './discovery-guard';
import { WorkspaceOptimizer } from './startup';
import {fastTabs} from './fast-tabs';
import {supportsAndroidAdapter} from './compatibility';
import {BenchmarkStore,StartupRecorder,MeasurePreferences,measureDefaults,HISTORY_LIMIT} from './benchmark';
import {MeasurementView} from './measurement-view';
import {protectForeground} from './foreground';
import {startMetadataPreload} from './metadata-preload';
import {PluginFiles} from './plugin-files';
import {promoteBooster} from './early-order';
import {inventoryStatus,inventorySaving,compareStartups,comparisonText,seconds} from './feedback';
import {guardViewState,defersInitialView} from './view-guard';
import {Localizer,LanguageChoice,Translator} from './i18n';
import {record,isMethod,parseJSON,callMethod} from './runtime';
import {patchMethods} from './method-patch';
import type {SettingItem,SettingRow} from './settings-definition';
export default class BootBooster extends Plugin {
  fastStart:FastStart|null=null;settings:Settings=defaults();
  fastMode:'auto'|'always'|'off'='auto';private preferenceKey='';private saves=Promise.resolve();
  private scheduler=new IdleScheduler();private stopped=false;
  private startup:WorkspaceOptimizer|null=null;
  measurementStore:BenchmarkStore|null=null;measurement:StartupRecorder|null=null;
  measurementPreferences:MeasurePreferences=measureDefaults();private measurementOnly=false;
  private timers=new Set<number>();
  private skippedPreviews=0;
  private pluginFiles:PluginFiles|null=null;private earlyOrder='inactive';
  private settingsLoaded=true;private appliedConfiguration='';private scopeIdentity='';
  private settingsTab:BoosterSettings|undefined;
  localization=new Localizer('en');
  readonly text:Translator=(key,values)=>this.localization.text(key,values);
  private languageCommands:{command:{name:string};key:'statusCommand'|'historyCommand'}[]=[];
  async onload():Promise<void>{
    const root=this.app.vault.adapter.getResourcePath('');
    this.localization=new Localizer(getLanguage(),window.localStorage,root);
    try{this.measurementStore=new BenchmarkStore(window.localStorage,root);this.measurementPreferences=this.measurementStore.preferences();}catch{/* Recording is optional. */}
    this.measurementOnly=this.measurementPreferences.mode==='measurement-only';
    if(this.measurementStore&&this.measurementPreferences.enabled&&!this.app.workspace.layoutReady){
      try{const element=record(record(this.app).dom).appContainerEl,container=typeof HTMLElement!=='undefined'&&element instanceof HTMLElement?element:undefined;
        const platform=record(Platform);
        const environment:Record<string,string|boolean>={bootBooster:this.manifest.version,api:apiVersion,android:Platform.isAndroidApp,mobile:Platform.isMobile};
        for(const name of ['version','build','osName','osVersion','manufacturer','model'])if(typeof platform[name]==='string'||typeof platform[name]==='number')environment[name]=String(platform[name]);
        this.measurement=new StartupRecorder(this.app,this.measurementStore,environment,this.measurementPreferences,{
          now:()=>performance.now(),wall:()=>Date.now(),origin:performance.timeOrigin,
          later:(fn,ms)=>window.setTimeout(fn,ms),cancel:timer=>window.clearTimeout(timer),
          loading:()=>container?.classList.contains('mod-loading')??null,visible:()=>document.visibilityState==='visible',
          watchLoading:changed=>{if(!container)return ()=>{};const observer=new MutationObserver(changed);observer.observe(container,{attributes:true,attributeFilter:['class']});return ()=>observer.disconnect();}
        });this.measurement.install();this.register(()=>this.measurement?.dispose());
        for(const event of ['pointerdown','keydown','wheel','touchstart'] as const)this.registerDomEvent(document,event,()=>this.measurement?.interaction(),{passive:true});
        this.registerDomEvent(document,'visibilitychange',()=>{if(document.visibilityState==='hidden')this.measurement?.interaction(true);});
      }catch{this.measurement?.dispose();this.measurement=null;}
    }
    this.register(()=>{for(const timer of this.timers)window.clearTimeout(timer);this.timers.clear();});
    let loaded=true;
    try{this.settings=parseSettings(await this.loadData(),this.app.vault.configDir);}catch{loaded=false;new Notice('Boot Booster: '+this.text('settingsLoadFailed'));}
    this.settingsLoaded=loaded;
    if(this.stopped)return;
    if(loaded&&!this.measurementOnly&&Platform.isAndroidApp&&supportsAndroidAdapter(apiVersion)){
      if(this.settings.startup.pluginFiles!==false){
        const key=`boot-booster:plugin-file-sizes:v1:${root}`;
        this.pluginFiles=new PluginFiles({api:apiVersion,adapter:this.app.vault.adapter,configDir:this.app.vault.configDir,manifests:record(record(this.app).plugins).manifests,
          load:()=>parseJSON(window.localStorage.getItem(key)||'null'),save:sizes=>window.localStorage.setItem(key,JSON.stringify(sizes))});
        this.pluginFiles.install();
      }
      this.earlyOrder='pending';
      this.app.workspace.onLayoutReady(()=>{
        if(this.stopped)return;this.pluginFiles?.checkpoint();
        // Enabling a plugin in an already open Vault adds it to enabledPlugins
        // after onload returns. Yield one task before inspecting membership.
        const timer=window.setTimeout(()=>{this.timers.delete(timer);if(this.stopped)return;
          void promoteBooster(record(this.app).plugins,this.manifest.id,()=>this.stopped).then(status=>{this.earlyOrder=status;},()=>{this.earlyOrder='failed';});
        },0);this.timers.add(timer);
      });
    }
    if(loaded&&!this.measurementOnly&&Platform.isAndroidApp&&!this.app.workspace.layoutReady){
      startMetadataPreload(this.app.metadataCache,apiVersion);
    }
    this.preferenceKey=`boot-booster:fast-enabled:${root}`;
    try{const value=window.localStorage.getItem(this.preferenceKey);this.fastMode=value==='off'||value==='false'?'off':value==='always'||value==='true'?'always':'auto';}catch{this.fastMode='off';}
    this.appliedConfiguration=this.nextConfiguration();
    try{const key=`boot-booster:comparison-scope:v1:${root}:${scopeKey(this.settings.scope)}`;
      this.scopeIdentity=window.localStorage.getItem(key)||`${Date.now()}-${Math.random().toString(36).slice(2)}`;window.localStorage.setItem(key,this.scopeIdentity);
    }catch{this.scopeIdentity='';/* Selected-folder comparisons require a stable identity. */}
    let templateGuard:ReturnType<typeof protectDiscoveredNotes>=null;
    const protect=()=>{const owner=templaterOwner(this.app);if(owner&&owner!==templateGuard?.owner){templateGuard?.dispose();templateGuard=protectDiscoveredNotes(this.app,p=>this.fastStart?.recognizing===p);}};
    // A draining inventory still discovers existing files after plugin unload.
    // Retain template protection until those read-only discoveries have ended.
    this.register(()=>{void (this.fastStart?.dispose()??Promise.resolve()).then(()=>templateGuard?.dispose());});
    if(!this.measurementOnly&&Platform.isAndroidApp&&loaded&&this.fastMode!=='off'){
      const scope=this.settings.scope;const key=`boot-booster:snapshot:v2:${root}:${scopeKey(scope)}`;
      this.fastStart=new FastStart({api:apiVersion,adapter:this.app.vault.adapter,scope,mode:this.fastMode,scheduler:this.scheduler,text:this.text,
        ready:()=>new Promise(resolve=>this.app.workspace.onLayoutReady(resolve)),startup:()=>!this.app.workspace.layoutReady,beforeRecognize:protect,
        load:()=>{const raw=window.localStorage.getItem(key);if(raw)return parseJSON(raw);
          if(!scope.all&&scope.folders.length===1){const old=window.localStorage.getItem(`boot-booster:snapshot:v1:${root}:${scope.folders[0]}`);if(old){const s=record(parseJSON(old));if(s.version===1&&s.target===scope.folders[0])return {...s,version:2,scope};}}return null;},
        save:s=>window.localStorage.setItem(key,JSON.stringify(s)),changed:reason=>{if(!this.stopped&&this.fastStart?.phase==='failed')new Notice('Boot Booster: '+reason,0);},
        defer:(fn,ms)=>{const timer=window.setTimeout(()=>{this.timers.delete(timer);fn();},ms);this.timers.add(timer);return timer;}});
      this.fastStart.install();
    }
    if(!this.measurementOnly&&loaded){this.startup=new WorkspaceOptimizer(this.app,this.settings.startup,this.scheduler);this.startup.install();}
    if(this.stopped)return;
    if(loaded&&!this.measurementOnly&&Platform.isAndroidApp&&supportsAndroidAdapter(apiVersion)){
      const app=record(this.app);
      if(this.settings.startup.fastTabs===true&&typeof app.appId==='string')this.register(fastTabs(app.mobileTabSwitcher,record(window).Capacitor,app.workspace,app.appId,apiVersion,()=>!this.stopped&&this.settings.startup.fastTabs===true,()=>this.skippedPreviews++));
    }
    if(this.fastStart&&this.fastStart.phase!=='unsupported')this.installActivityHooks();
    this.measurement?.observeActions(WorkspaceLeaf.prototype,record(this.app).mobileTabSwitcher);
    this.languageCommands=[{command:this.addCommand({id:'diagnostics',name:this.text('statusCommand'),callback:()=>this.openSettings()}),key:'statusCommand'},
      {command:this.addCommand({id:'startup-measurements',name:this.text('historyCommand'),callback:()=>this.openMeasurements()}),key:'historyCommand'}];
    this.settingsTab=new BoosterSettings(this.app,this);this.addSettingTab(this.settingsTab);
    this.measurement?.configure({settingsLoaded:loaded,optimizationEnabled:!this.measurementOnly,fastMode:this.fastMode,scope:{all:this.settings.scope.all,folderCount:this.settings.scope.folders.length,identity:this.scopeIdentity||undefined},startup:{...this.settings.startup,pluginFiles:this.settings.startup.pluginFiles!==false,fastTabs:this.settings.startup.fastTabs===true,plugins:'native',first:!this.measurementOnly&&this.earlyOrder!=='inactive'}},()=>this.diagnosticReport());
    this.measurement?.onloadFinished();
  }
  private installActivityHooks():void {
    const active=()=>{const file=this.app.workspace.getActiveFile();if(file)this.scheduler.prioritize(file.path);else this.scheduler.activity();};
    const originalOpen=record(WorkspaceLeaf.prototype).openFile,originalState=record(WorkspaceLeaf.prototype).setViewState;
    const scheduler=this.scheduler;
    const scanning=()=>!this.stopped&&(this.fastStart?.phase==='provisional'||this.fastStart?.phase==='reconciling');
    this.register(protectForeground(record(this.app).mobileTabSwitcher,'show',scheduler,scanning,{coalesce:true}));
    if(isMethod(originalOpen)&&isMethod(originalState)){
    const open=async(receiver:WorkspaceLeaf,file:TFile,args:unknown[])=>{
      if(record(receiver).app!==this.app||!scanning())return originalOpen.apply(receiver,[file,...args]);
      const release=scheduler.beginForeground(file.path);
      try{return await originalOpen.apply(receiver,[file,...args]);}finally{release();}
    };
    const state=guardViewState(originalState,{owns:leaf=>leaf.app===this.app,scanning,scheduler,deferOnly:(leaf,state)=>defersInitialView(leaf,state,apiVersion),
      ensure:path=>this.fastStart!.ensurePath(path)});
    const undo=patchMethods([{host:WorkspaceLeaf.prototype,name:'openFile',replacement:function(this:WorkspaceLeaf,file:TFile,...args:unknown[]){return open(this,file,args);}},
      {host:WorkspaceLeaf.prototype,name:'setViewState',replacement:state}]);
    if(undo)this.register(undo);
    }
    const changed=()=>this.fastStart?.contentChanged();
    this.registerEvent(this.app.vault.on('create',changed));this.registerEvent(this.app.vault.on('modify',changed));
    this.registerEvent(this.app.vault.on('delete',changed));this.registerEvent(this.app.vault.on('rename',changed));
    this.registerEvent(this.app.workspace.on('active-leaf-change',active));
    this.registerEvent(this.app.workspace.on('file-open',active));
    this.registerEvent(this.app.workspace.on('editor-change',()=>this.scheduler.activity(1800)));
    for(const event of ['pointerdown','keydown','wheel','touchstart'] as const)this.registerDomEvent(document,event,()=>this.scheduler.activity(1800),{passive:true});
    this.registerDomEvent(document,'visibilitychange',()=>{this.scheduler.activity();if(document.visibilityState==='hidden')this.startup?.checkpoint();});
  }
  onunload():void{this.stopped=true;this.pluginFiles?.dispose();this.startup?.dispose();if(this.fastStart)void this.fastStart.dispose();else this.scheduler.stop();}
  setFastMode(mode:'auto'|'always'|'off'):void{try{window.localStorage.setItem(this.preferenceKey,mode);this.fastMode=mode;new Notice(this.text('nextStartup'));}catch{new Notice(this.text('settingsSaveFailed'));}}
  setLanguage(choice:LanguageChoice):void{try{this.localization.set(choice);for(const {command,key} of this.languageCommands)command.name=`${this.manifest.name}: ${this.text(key)}`;}catch{new Notice(this.text('settingsSaveFailed'));}}
  setFastEnabled(enabled:boolean):void{this.setFastMode(enabled?'always':'off');}
  private openSettings(records=false):void{const setting=record(this.app).setting;callMethod(setting,'open');callMethod(setting,'openTabById',this.manifest.id);if(records)this.settingsTab?.recordsEl?.scrollIntoView({block:'start'});}
  openMeasurements():void{if(this.measurementStore)this.openSettings(true);else new Notice(this.text('storageUnavailable'));}
  setMeasurementPreferences(change:Partial<MeasurePreferences>,notify=true):void{
    const next={...this.measurementPreferences,...change};try{if(!this.measurementStore)throw Error('Unavailable');this.measurementStore.setPreferences(next);this.measurementPreferences=next;if(notify)new Notice(this.text('nextStartup'));}catch{new Notice(this.text('measureSaveFailed'));}
  }
  private nextConfiguration():string{return JSON.stringify([this.settings,this.fastMode,this.measurementPreferences]);}
  feedback(){
    const mode=this.measurementOnly?'measurement-only':'optimized';
    const status=inventoryStatus(this.fastStart,this.scheduler.waitingFor,mode,Platform.isAndroidApp&&supportsAndroidAdapter(apiVersion),this.text);
    if(!this.settingsLoaded){status.title=this.text('settingsFallback');status.detail=this.text('settingsFallbackHelp');status.next=this.text('settingsRecovery');}
    const current=this.measurement?.run,history=this.measurementStore?.runs(current)??[];
    const latest=current??history[history.length-1];
    const pending=this.appliedConfiguration!==this.nextConfiguration();
    return {...status,pending,next:pending?this.text('pending'):status.next,inventory:inventorySaving(this.fastStart,this.text),
      startup:latest?.milestones.uiReadyMs!=null?this.text(current?'currentTime':'lastTime',{time:seconds(latest.milestones.uiReadyMs,this.text)}):'',
      comparison:comparisonText(compareStartups(history,latest),this.text)};
  }
  async setScope(scope:Scope):Promise<void>{
    const normalized={all:scope.all,folders:normalizeScope({all:false,folders:scope.folders},this.app.vault.configDir).folders};
    this.saves=this.saves.then(async()=>{const next:Settings={...this.settings,scope:normalized};await this.saveData(next);this.settings=next;}).catch(()=>{new Notice(this.text('settingsSaveFailed'));});
    await this.saves;
  }
  async setStartup(change:Partial<StartupSettings>):Promise<void>{
    this.saves=this.saves.then(async()=>{const next:Settings={...this.settings,startup:{...this.settings.startup,...change}};await this.saveData(next);this.settings=next;}).catch(()=>{new Notice(this.text('settingsSaveFailed'));});await this.saves;
  }
  diagnosticReport():object{return {version:this.manifest.version,api:apiVersion,mode:this.fastMode,measurementMode:this.measurementOnly?'measurement-only':'optimized',recordingStatus:this.measurement?.run.status??'off',scope:this.settings.scope,
    startup:this.startup?{...this.startup.diagnostics(),first:this.earlyOrder,pluginFiles:this.pluginFiles?.timing??null,tabSnapshotsSkipped:this.skippedPreviews}:null,startupSettings:this.settings.startup,
    fastStart:this.fastStart?{phase:this.fastStart.phase,reason:this.fastStart.reason,startupCalls:this.fastStart.startupCalls,cacheState:this.fastStart.cacheState,seeded:this.fastStart.seeded,scanned:this.fastStart.scanned,provisionalAtMs:this.fastStart.provisionalAtMs,verifiedAtMs:this.fastStart.verifiedAtMs,idleWaits:this.scheduler.waits,pointStats:this.fastStart.pointStats,startupPointStats:this.fastStart.startupPointStats,foregroundStatReuses:this.fastStart.foregroundStatReuses,pointStatMs:this.fastStart.pointStatMs,pointQueueWaitMs:this.fastStart.pointQueueWaitMs,cacheLoadMs:this.fastStart.cacheLoadMs,seedMs:this.fastStart.seedMs,inventoryMs:this.fastStart.inventoryMs,normalInventoryMs:this.fastStart.normalInventoryMs,progress:{...this.fastStart.progress,waitingFor:this.scheduler.waitingFor},background:this.fastStart.background,scheduler:this.scheduler.timing}:null};}
}
class BoosterSettings extends PluginSettingTab {
  private refreshers=new Set<()=>void>();
  private rowCleanups=new Map<HTMLElement,()=>void>();
  recordsEl:HTMLElement|undefined;
  constructor(app:App,private booster:BootBooster){super(app,booster);booster.register(()=>this.hide());}
  hide():void{for(const dispose of this.rowCleanups.values())dispose();this.rowCleanups.clear();for(const dispose of this.refreshers)dispose();this.refreshers.clear();this.recordsEl=undefined;}
  private renderRow(setting:Setting,render:SettingRow['render']):()=>void {
    this.rowCleanups.get(setting.settingEl)?.();
    const before=new Set(Array.from(setting.infoEl.children)),dispose=render(setting);
    const added=Array.from(setting.infoEl.children).filter(node=>!before.has(node)&&node!==setting.controlEl);
    let retired=false;
    const cleanup=()=>{if(retired)return;retired=true;dispose?.();for(const node of added)node.remove();
      // The history places native controls below its table; restore their parent before host reuse.
      if(setting.controlEl.parentElement===setting.infoEl)setting.settingEl.appendChild(setting.controlEl);
      setting.clear();setting.descEl.empty();this.rowCleanups.delete(setting.settingEl);
    };
    this.rowCleanups.set(setting.settingEl,cleanup);return cleanup;
  }
  private poll(update:()=>void):()=>void {
    update();const timer=window.setInterval(update,1000),dispose=()=>{window.clearInterval(timer);this.refreshers.delete(dispose);};
    this.refreshers.add(dispose);return dispose;
  }
  private redisplay():void {this.hide();if(isMethod(record(this).update))callMethod(this,'update');else this.display();}
  getSettingDefinitions():SettingItem[]{
    const t=this.booster.text;
    const row=(name:Parameters<Translator>[0],desc:Parameters<Translator>[0]|undefined,render:SettingRow['render']):SettingRow=>{
      const definition:SettingRow={name:t(name),...(desc?{desc:t(desc)}:{}),render:setting=>this.renderRow(setting,()=>{
        setting.setName(definition.name).setDesc(definition.desc??'');return render(setting);
      })};return definition;
    };
    const scope=row('scope','scopeHelp',setting=>{
      setting.addDropdown(d=>d.addOptions({folders:t('chooseFolders'),all:t('wholeVault')}).setValue(this.booster.settings.scope.all?'all':'folders').onChange(v=>{void this.booster.setScope({all:v==='all',folders:this.booster.settings.scope.folders}).then(()=>this.redisplay());}));
      if(this.booster.settings.scope.all)return;
      const folders=setting.infoEl.createDiv({cls:'boot-booster-folders',attr:{'aria-label':t('selectedFolders')}});
      if(!this.booster.settings.scope.folders.length)setting.descEl.createDiv({text:t('noFolders')});
      for(const path of this.booster.settings.scope.folders){
        const chip=folders.createSpan({cls:'boot-booster-folder'});chip.createSpan({text:path});
        const remove=chip.createEl('button',{cls:'clickable-icon',text:'×',attr:{type:'button','aria-label':t('removeFolder',{path}),title:t('remove')}});
        remove.addEventListener('click',()=>{void this.booster.setScope({all:false,folders:this.booster.settings.scope.folders.filter(p=>p!==path)}).then(()=>this.redisplay());});
      }
    });
    const addFolder=row('addFolder',undefined,setting=>{
      const options=this.app.vault.getAllFolders().map(f=>f.path).filter(p=>validTarget(p,this.app.vault.configDir)&&!this.booster.settings.scope.folders.includes(p)).sort();let choice=options[0]??'';
      setting.addDropdown(d=>{for(const p of options)d.addOption(p,p);d.setValue(choice).onChange(v=>{choice=v;});})
        .addButton(b=>b.setButtonText(t('add')).setDisabled(!choice).onClick(async()=>{await this.booster.setScope({all:false,folders:[...this.booster.settings.scope.folders,choice]});this.redisplay();}));
    });
    addFolder.visible=!this.booster.settings.scope.all;
    const status=row('status',undefined,setting=>this.poll(statusPanel(setting,this.booster)));
    const history=row('history','historyHelp',setting=>{
      this.recordsEl=setting.settingEl;setting.setClass('boot-booster-record-section');
      const store=this.booster.measurementStore;if(!store)return;
      const records=new MeasurementView(setting.settingEl,store,()=>this.booster.measurement?.run,t,this.booster.localization.language,setting);
      return this.poll(()=>records.render());
    });
    const recording=row('recording',undefined,setting=>{
      setting.addToggle(v=>v.setValue(this.booster.measurementPreferences.enabled).setDisabled(this.booster.measurementPreferences.mode==='measurement-only').onChange(value=>this.booster.setMeasurementPreferences({enabled:value})));
    });recording.desc=t('recordingHelp',{count:HISTORY_LIMIT});
    return [status,{type:'group',heading:t('optimization'),items:[
      row('inventorySetting','inventoryHelp',setting=>{setting.addDropdown(d=>d.addOptions({auto:t('auto'),always:t('always'),off:t('off')}).setValue(this.booster.fastMode).onChange(v=>this.booster.setFastMode(v as 'auto'|'always'|'off')));}),
      scope,addFolder,
      row('tabs','tabsHelp',setting=>{setting.addToggle(v=>v.setValue(this.booster.settings.startup.workspace).onChange(value=>this.booster.setStartup({workspace:value})));}),
      row('plugins','pluginsHelp',setting=>{setting.addToggle(v=>v.setValue(this.booster.settings.startup.pluginFiles!==false).onChange(value=>this.booster.setStartup({pluginFiles:value})));}),
      row('previews','previewsHelp',setting=>{setting.addToggle(v=>v.setValue(this.booster.settings.startup.fastTabs===true).onChange(value=>this.booster.setStartup({fastTabs:value})));}),
      row('language',undefined,setting=>{setting.addDropdown(d=>d.addOptions({ja:'日本語',en:'English'}).setValue(this.booster.localization.choice).onChange(value=>{this.booster.setLanguage(value as LanguageChoice);this.redisplay();}));})
    ]},{type:'group',heading:t('timingHeading'),items:[
      row('startupMode','modeHelp',setting=>{setting.addDropdown(d=>d.addOptions({optimized:t('optimized'),'measurement-only':t('normalMeasure')}).setValue(this.booster.measurementPreferences.mode).onChange(v=>{this.booster.setMeasurementPreferences({mode:v as MeasurePreferences['mode'],...(v==='measurement-only'?{enabled:true}:{})});this.redisplay();}));}),
      recording,history
    ]}];
  }
  /** Fallback for Obsidian before 1.13; the definitions also drive this layout. */
  display():void{
    this.hide();const el=this.containerEl;el.empty();
    const render=(row:SettingRow)=>{if(row.visible===false)return;const setting=new Setting(el).setName(row.name);if(row.desc)setting.setDesc(row.desc);row.render(setting);};
    for(const item of this.getSettingDefinitions())if('type' in item){if(item.heading)new Setting(el).setName(item.heading).setHeading();item.items.forEach(render);}else render(item);
  }
}
function statusPanel(setting:Setting,plugin:BootBooster):()=>void {
  const t=plugin.text;setting.setName(t('status')).setClass('boot-booster-status');
  const title=setting.descEl.createDiv(),work=setting.descEl.createDiv(),detail=setting.descEl.createDiv(),next=setting.descEl.createEl('p');
  const startup=setting.descEl.createEl('p'),comparison=setting.descEl.createDiv(),inventory=setting.descEl.createDiv();
  const diagnostics=setting.infoEl.createEl('details',{cls:'boot-booster-diagnostics'});diagnostics.createEl('summary',{text:t('diagnostics')});
  const box=diagnostics.createEl('textarea',{cls:'boot-booster-report',attr:{readonly:'',rows:'10','aria-label':t('diagnostics')}});
  return ()=>{const f=plugin.feedback();for(const [node,value] of [[title,f.title],[work,f.work],[detail,f.detail],[next,f.next],[startup,f.startup],[comparison,f.comparison],[inventory,f.inventory]] as const){if(node.textContent!==value)node.setText(value);node.hidden=!value;}if(diagnostics.open&&document.activeElement!==box)box.value=JSON.stringify(plugin.diagnosticReport(),null,2);};
}
