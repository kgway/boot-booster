/** Startup telemetry stays on this device. No file paths, contents or Vault file I/O. */
import {record,isRecord,isMethod,isThenable,parseJSON,UnknownRecord} from './runtime';
import {patchMethods} from './method-patch';
export const HISTORY_LIMIT=20;
export interface MeasurePreferences {enabled:boolean;mode:'optimized'|'measurement-only';}
export const measureDefaults=():MeasurePreferences=>({enabled:true,mode:'optimized'});
export interface Phase {startMs:number;durationMs:number;ok:boolean;}
export interface StartupRun {
  id:string;startedAt:string;kind:'startup'|'late-load';status:'in-progress'|'complete'|'timeout'|'interrupted';
  environment:Record<string,string|boolean>;condition:MeasurePreferences&{label?:string;};
  configuration:Record<string,unknown>;bootBoosterOnloadMs:number|null;recorderSetupMs:number;
  milestones:{pluginStartedMs:number;layoutReadyMs:number|null;uiReadyMs:number|null;metadataResolvedMs:number|null;verificationMs:number|null;pluginsSettledMs:number|null;settledMs:number|null;};
  phases:Record<string,Phase[]>;plugins:Record<string,{version:string;beforeRecorder:boolean;loads:Phase[];decision?:string;status?:string}>;
  counts:{files:number|null;tabs:number|null;deferredTabs:number|null;};
  uiReadyState?:{files:number|null;tabs:number|null;deferredTabs:number|null;hidden:boolean;interacted:boolean;};
  fastStart:Record<string,unknown>|null;startup:Record<string,unknown>|null;interaction:{firstMs:number|null;events:number;hidden:boolean;};
  unavailable:string[];
  observation?:{atMs:number;checkpoint:'periodic'|'hidden'|'unload'|'final';interruption?:'unload'|'previous-process-incomplete';};
  responsiveness?:{samples:number;maxTimerLagMs:number;timerLagOver50Ms:number;};
  actions?:Record<string,Phase[]>;
}
export interface Store {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const optionalTime=(value:unknown)=>value===null||finite(value);
function isPhase(value:unknown):value is Phase {const p=record(value);return finite(p.startMs)&&finite(p.durationMs)&&typeof p.ok==='boolean';}
/** Reject malformed stored rows before settings and comparisons consume them. */
function isStartupRun(value:unknown):value is StartupRun {
  if(!isRecord(value))return false;
  const r=value,m=record(r.milestones),condition=record(r.condition),counts=record(r.counts),interaction=record(r.interaction);
  if(typeof r.id!=='string'||typeof r.startedAt!=='string'||!['startup','late-load'].includes(String(r.kind))||
    !['in-progress','complete','timeout','interrupted'].includes(String(r.status))||
    !isRecord(r.environment)||!Object.values(r.environment).every(v=>typeof v==='string'||typeof v==='boolean')||
    !isRecord(r.configuration)||typeof condition.enabled!=='boolean'||!['optimized','measurement-only'].includes(String(condition.mode))||
    !finite(m.pluginStartedMs)||!['layoutReadyMs','uiReadyMs','metadataResolvedMs','verificationMs','pluginsSettledMs','settledMs'].every(k=>optionalTime(m[k]))||
    !optionalTime(r.bootBoosterOnloadMs)||!finite(r.recorderSetupMs)||
    !['files','tabs','deferredTabs'].every(k=>optionalTime(counts[k]))||!optionalTime(interaction.firstMs)||!finite(interaction.events)||typeof interaction.hidden!=='boolean'||
    !isRecord(r.phases)||!Object.values(r.phases).every(v=>Array.isArray(v)&&v.every(isPhase))||
    !isRecord(r.plugins)||!Object.values(r.plugins).every(v=>{const p=record(v);return typeof p.version==='string'&&typeof p.beforeRecorder==='boolean'&&Array.isArray(p.loads)&&p.loads.every(isPhase);})||
    !(r.fastStart===null||isRecord(r.fastStart))||!(r.startup===null||isRecord(r.startup))||
    !Array.isArray(r.unavailable)||!r.unavailable.every((v:unknown)=>typeof v==='string'))return false;
  if(r.uiReadyState!==undefined){const ui=record(r.uiReadyState);if(!['files','tabs','deferredTabs'].every(k=>optionalTime(ui[k]))||typeof ui.hidden!=='boolean'||typeof ui.interacted!=='boolean')return false;}
  if(r.observation!==undefined){const o=record(r.observation);if(!finite(o.atMs)||!['periodic','hidden','unload','final'].includes(String(o.checkpoint)))return false;}
  return true;
}
export class BenchmarkStore {
  readonly preferencesKey:string;readonly historyKey:string;
  private cleared=new Set<string>();
  constructor(private storage:Store,root:string){this.preferencesKey=`boot-booster:measurement:preferences:v1:${root}`;this.historyKey=`boot-booster:measurement:history:v1:${root}`;}
  preferences():MeasurePreferences{try{const p=record(parseJSON(this.storage.getItem(this.preferencesKey)||'null'));return {enabled:p.enabled!==false,mode:p.mode==='measurement-only'?'measurement-only':'optimized'};}catch{return measureDefaults();}}
  setPreferences(p:MeasurePreferences):void{this.storage.setItem(this.preferencesKey,JSON.stringify({enabled:p.enabled,mode:p.mode}));}
  history():StartupRun[]{try{const a=parseJSON(this.storage.getItem(this.historyKey)||'null');return Array.isArray(a)?a.filter(isStartupRun).slice(-HISTORY_LIMIT):[];}catch{return [];}}
  save(run:StartupRun):void{if(this.cleared.has(run.id))return;const history=this.history().filter(r=>r.id!==run.id).map(r=>r.status==='in-progress'?{...r,status:'interrupted' as const,observation:{...r.observation,atMs:r.observation?.atMs??r.milestones.uiReadyMs??r.milestones.pluginStartedMs,checkpoint:r.observation?.checkpoint??'periodic' as const,interruption:'previous-process-incomplete' as const}}:r);history.push(run);this.storage.setItem(this.historyKey,JSON.stringify(history.slice(-HISTORY_LIMIT)));}
  clear(current?:StartupRun):void{const ids=this.runs(current).map(r=>r.id);this.storage.removeItem(this.historyKey);for(const id of ids)this.cleared.add(id);}
  runs(current?:StartupRun):StartupRun[]{
    const history=this.history().filter(r=>!this.cleared.has(r.id));
    if(current?.kind==='startup'&&!this.cleared.has(current.id)){const i=history.findIndex(r=>r.id===current.id);if(i>=0)history[i]=current;else history.push(current);}
    return history.slice(-HISTORY_LIMIT);
  }
  export(current?:StartupRun):string{
    const history=this.runs(current);
    return JSON.stringify({schema:'boot-booster-startup-benchmark/v1',unit:'ms',exportedAt:new Date().toISOString(),definitions:{
      clock:'Milliseconds since this renderer navigation began (performance.now), not native app launch time. Not Obsidian official Total startup time.',
      uiReadyMs:'Layout-ready observed and app loading overlay removed. This is a UI milestone, not a guarantee all background work has ended.',
      phases:'Observed method invocation durations, not the official startup breakdown. Missing or earlier phases remain absent. Overlapping durations must not be summed.',
      metadataResolvedMs:'Last Obsidian metadata resolved event observed before completion; does not certify third-party indexes.',
      settledMs:'UI ready, Vault verification no longer active (inspect phase for failures), observed plugin loads complete and a metadata resolved event observed. Before 1.9.0 this also waited for the deferred plugin queue. Third-party async indexing may continue.',
      plugins:'Only loadPlugin invocations observed in this run. beforeRecorder plugins have no invented load duration. Boot Booster own onload excludes earlier module evaluation.',
      comparison:'Compare matching environment, plugin versions, configuration and UI-ready counts. A clean uiReadyState permits UI timing comparison after later recording interruption; legacy runs require complete visible recording. Late-load or missing UI readiness is excluded. Cache state and OS load can still differ; these are observations, not counterfactual startup times.',
      observation:'atMs is the last captured state. Interrupted means recording did not finish, not that UI startup failed. previous-process-incomplete is inferred on a later run; its snapshot may precede actual process termination.',
      background:'Directory nativeListMs, adapter queueWaitMs and applyMs measure different scan steps. Scheduler totals aggregate all callers, including overlapping waits, and may exceed elapsed time; do not sum with phases. Updated/unchanged count inventory entries, including folders.',
      inventory:'inventoryMs observes this watchAndList call including cache preparation. normalInventoryMs is a previous native watchAndList observation for this scope and app API, stored in the inventory snapshot. It is a reference for file-list preparation only, not a counterfactual total startup time.',
      uiReadyState:'Counts and visibility/input conditions captured once when UI readiness is observed. Later tab changes or background recording interruption do not change this snapshot. Legacy runs have no snapshot and require completed, visible recording for automatic comparison.',
      verification:'progress exports stage, nativePending and scheduler waitingFor only, without paths. watchMs is native watcher setup; indexMs is elapsed preparation of the child index, including scheduler waits. pointStatMs and pointQueueWaitMs cover on-demand checks, including overlapping callers; startupPointStats counts native stats before layout readiness; foregroundStatReuses counts read preflights reused within the same foreground operation. A later open or mutation requires a fresh check. Do not sum these with startup phases.',
      responsiveness:'Delay of the existing 1-second recorder timer beyond its target time, from recorder installation onwards. Indicates renderer scheduling delay; does not identify its cause or measure native app launch.',
      actions:'First 20 observed calls per action after UI ready and before recording ends. noteOpen includes Boot Booster foreground preparation; tabOverview includes the native show promise. Method completion is not a painted frame or keyboard input latency. Nested calls can overlap; do not sum. No action means unobserved, not zero latency.',
      privacy:'No vault name, note paths or note contents. Historical runs may contain user-entered labels. New runs do not record labels. Stored only on this device; copying does not send data.'
    },runs:history.slice(-HISTORY_LIMIT)},null,2);
  }
}
export interface BenchmarkHost {
  workspace:{layoutReady:boolean;onLayoutReady(fn:()=>void):void;iterateAllLeaves(visit:(leaf:{isDeferred?:boolean})=>void):void};
  vault:{getFiles():unknown[]};metadataCache:unknown;plugins?:unknown;
}
export interface BenchmarkRuntime {
  now():number;wall():number;origin:number;
  later(fn:()=>void,ms:number):number;cancel(timer:number|undefined):void;
  watchLoading?(changed:()=>void):()=>void;
  loading?():boolean|null;
  visible?():boolean;
}
export class StartupRecorder {
  readonly run:StartupRun;private stopped=false;private finished=false;private timer:number|undefined;
  private disposers:(()=>void)[]=[];private metadataSeen=false;private lastSaved='';
  private state:()=>unknown=()=>({});private bootStart:number;private stableSince:number|null=null;private checkpointAt=-Infinity;
  private timerDue=0;
  private activeActions=0;private activePluginLoads=0;
  constructor(private app:BenchmarkHost,private store:BenchmarkStore,environment:Record<string,string|boolean>,condition:MeasurePreferences,private runtime:BenchmarkRuntime){
    const start=runtime.now();this.bootStart=start;
    this.run={id:String(runtime.origin),startedAt:new Date(runtime.origin||runtime.wall()-start).toISOString(),kind:app.workspace.layoutReady?'late-load':'startup',status:'in-progress',environment,condition:{enabled:condition.enabled,mode:condition.mode},configuration:{},bootBoosterOnloadMs:null,recorderSetupMs:0,
      milestones:{pluginStartedMs:round(start),layoutReadyMs:null,uiReadyMs:null,metadataResolvedMs:null,verificationMs:null,pluginsSettledMs:null,settledMs:null},phases:{},plugins:{},counts:{files:null,tabs:null,deferredTabs:null},fastStart:null,startup:null,interaction:{firstMs:null,events:0,hidden:false},unavailable:[],responsiveness:{samples:0,maxTimerLagMs:0,timerLagOver50Ms:0}};
  }
  install():void{
    const start=this.runtime.now(),m=record(this.app.plugins),enabled=m.enabledPlugins;
    if(enabled instanceof Set||Array.isArray(enabled))for(const id of enabled as Iterable<unknown>){if(typeof id!=='string')continue;const manifest=record(m.manifests)[id],version=record(manifest).version;this.run.plugins[id]={version:typeof version==='string'?version:'',beforeRecorder:!!record(m.plugins)[id],loads:[],...(!manifest?{decision:'missing-manifest',status:'Manifest not found'}:{})};}
    this.wrap(this.app.vault,'load','readingFiles');this.wrap(this.app.metadataCache,'initialize','loadingMetadata');
    this.wrap(this.app.metadataCache,'_preload','metadataPreload');
    this.wrap(this.app.workspace,'loadLayout','workspaceLayout');
    if(isMethod(record(this.app.workspace).readWorkspaceFile))this.wrap(this.app.workspace,'readWorkspaceFile','workspaceFile');
    this.wrap(m,'loadPlugin','plugin');
    this.listen(this.app.metadataCache,'resolved',()=>{this.metadataSeen=true;this.run.milestones.metadataResolvedMs=round(this.runtime.now());});
    this.app.workspace.onLayoutReady(()=>{if(this.stopped)return;this.run.milestones.layoutReadyMs=round(this.runtime.now());this.checkUI();this.schedule(0);});
    if(this.runtime.watchLoading)this.disposers.push(this.runtime.watchLoading(()=>this.checkUI()));
    else this.run.unavailable.push('loading-overlay-observer');
    this.run.recorderSetupMs=round(this.runtime.now()-start);this.schedule(1000);
  }
  configure(configuration:Record<string,unknown>,state:()=>unknown):void{this.run.configuration=configuration;this.state=state;}
  /** Install outside foreground preparation so its waiting time is included. */
  observeActions(leafPrototype:unknown,tabSwitcher:unknown):void{
    this.observeAction(leafPrototype,'openFile','noteOpen',receiver=>record(receiver).app===this.app);
    this.observeAction(tabSwitcher,'show','tabOverview',()=>true);
  }
  private observeAction(value:unknown,name:string,key:string,accept:(receiver:unknown)=>boolean):void{
    const host=record(value),original=host[name];if(!isMethod(original))return;
    const observe=(receiver:unknown,args:unknown[])=>{

      this.checkUI();
      if(this.stopped||this.finished||this.run.milestones.uiReadyMs===null||!accept(receiver))return original.apply(receiver,args);
      const begin=this.runtime.now();let done=false;this.activeActions++;
      const finish=(ok:boolean)=>{
        if(done)return;done=true;this.activeActions--;
        if(this.stopped||this.finished)return;
        const phases=((this.run.actions??={})[key]??=[]);
        if(phases.length<20)phases.push({startMs:round(begin),durationMs:round(this.runtime.now()-begin),ok});
      };
      try{const result=original.apply(receiver,args);if(isThenable(result))void Promise.resolve(result).then(()=>finish(true),()=>finish(false));else finish(true);return result;}
      catch(error){finish(false);throw error;}
    };
    const undo=patchMethods([{host,name,replacement:function(this:unknown,...args:unknown[]){return observe(this,args);}}]);
    if(undo)this.disposers.push(undo);else this.run.unavailable.push(key);
  }
  onloadFinished():void{this.run.bootBoosterOnloadMs=round(this.runtime.now()-this.bootStart);}
  interaction(hidden=false):void{if(this.finished||this.stopped)return;if(hidden){this.run.interaction.hidden=true;this.capture('hidden');if(this.run.milestones.uiReadyMs!==null)this.counts();this.persist();return;}this.run.interaction.events++;this.run.interaction.firstMs??=round(this.runtime.now());}
  private listen(value:unknown,event:string,fn:()=>void):void{const host=record(value),on=host.on,off=host.offref;if(!isMethod(on)||!isMethod(off)){this.run.unavailable.push(event);return;}const ref=on.call(host,event,()=>{if(!this.stopped&&!this.finished)fn();});this.disposers.push(()=>{off.call(host,ref);});}
  private wrap(value:unknown,name:string,key:string):void{
    const host=record(value),original=host[name];if(!isMethod(original)){this.run.unavailable.push(key);return;}
    const observe=(receiver:unknown,args:unknown[])=>{

      if(this.stopped||this.finished)return original.apply(receiver,args);
      const begin=this.runtime.now();let done=false;
      if(key==='plugin'){this.activePluginLoads++;this.run.milestones.pluginsSettledMs=null;}
      const finish=(ok:boolean)=>{if(done)return;done=true;if(key==='plugin')this.activePluginLoads--;if(this.stopped||this.finished)return;
        const phase={startMs:round(begin),durationMs:round(this.runtime.now()-begin),ok};
        if(key==='plugin'){
          const id=args[0];if(typeof id==='string'){const version=record(record(host.manifests)[id]).version,plugin=this.run.plugins[id]??={version:typeof version==='string'?version:'',beforeRecorder:false,loads:[]};plugin.loads.push(phase);plugin.decision='native';plugin.status=ok?'Loaded normally':'Load failed';}
        }else (this.run.phases[key]??=[]).push(phase);
      };
      try{const result=original.apply(receiver,args);if(isThenable(result))void Promise.resolve(result).then(()=>finish(true),()=>finish(false));else finish(true);return result;}
      catch(error){finish(false);throw error;}
    };
    const undo=patchMethods([{host,name,replacement:function(this:unknown,...args:unknown[]){return observe(this,args);}}]);
    if(undo)this.disposers.push(undo);else this.run.unavailable.push(key);
  }
  private checkUI():void{
    if(this.stopped||this.finished||this.run.milestones.layoutReadyMs===null||this.run.milestones.uiReadyMs!==null)return;
    const loading=this.runtime.loading?.();if(loading!==true){this.run.milestones.uiReadyMs=round(this.runtime.now());this.counts();this.run.uiReadyState={...this.run.counts,hidden:this.run.interaction.hidden||this.runtime.visible?.()===false,interacted:this.run.interaction.firstMs!==null};if(loading==null)this.run.unavailable.push('loading-overlay');}
  }
  private schedule(ms:number):void{if(this.stopped||this.finished)return;this.runtime.cancel(this.timer);this.timerDue=this.runtime.now()+ms;this.timer=this.runtime.later(()=>{this.timer=undefined;const lag=round(Math.max(0,this.runtime.now()-this.timerDue)),r=this.run.responsiveness!;r.samples++;r.maxTimerLagMs=Math.max(r.maxTimerLagMs,lag);if(lag>50)r.timerLagOver50Ms++;this.tick();},ms);}
  private readState():UnknownRecord{try{return record(this.state());}catch{if(!this.run.unavailable.includes('diagnostic-state'))this.run.unavailable.push('diagnostic-state');return {fastStart:{phase:'unavailable'}};}}
  private capture(checkpoint:'periodic'|'hidden'|'unload'|'final',state=this.readState()):void{
    const fast=isRecord(state.fastStart)?state.fastStart:null,queue=isRecord(state.startup)?state.startup:null;
    this.run.observation={...this.run.observation,atMs:round(this.runtime.now()),checkpoint};
    this.run.fastStart=fast?Object.fromEntries(['phase','startupCalls','cacheState','seeded','scanned','provisionalAtMs','verifiedAtMs','idleWaits','pointStats','startupPointStats','foregroundStatReuses','pointStatMs','pointQueueWaitMs','cacheLoadMs','seedMs','inventoryMs','normalInventoryMs'].map(k=>[k,fast[k]])):null;
    // Copy only explicit numeric fields; diagnostics can contain note paths.
    if(fast?.background)this.run.fastStart!.background=Object.fromEntries(['startedAtMs','watchMs','indexMs','directories','nativeListMs','queueWaitMs','applyMs','unchanged','updated','missingChecks'].map(k=>[k,record(fast.background)[k]]));
    if(fast?.progress)this.run.fastStart!.progress=Object.fromEntries(['stage','nativePending','waitingFor'].map(k=>[k,record(fast.progress)[k]]));
    if(fast?.scheduler)this.run.fastStart!.scheduler=Object.fromEntries(['waitMs','hiddenMs','foregroundMs','quietMs','yieldMs','yields'].map(k=>[k,record(fast.scheduler)[k]]));
    this.run.startup=queue?Object.fromEntries(['first','pluginLoading','auditRequired','waitingForInventory','waitingForMetadata','hintedWorkspaceViews','lazyLoaderPresent','failures','tabSnapshotsSkipped'].map(k=>[k,queue[k]])):null;
    if(queue?.pluginFiles)this.run.startup!.pluginFiles=Object.fromEntries(['nativeReads','streamReads','fallbacks','bytes','streamMs'].map(k=>[k,record(queue.pluginFiles)[k]]));
    if(fast?.phase==='verified')this.run.milestones.verificationMs??=round(typeof fast.verifiedAtMs==='number'?fast.verifiedAtMs:this.runtime.now());
    if(Array.isArray(queue?.plugins))for(const value of queue.plugins){const row=record(value),p=typeof row.id==='string'?this.run.plugins[row.id]:undefined;if(p&&p.decision!=='missing-manifest'){if(typeof row.reason==='string')p.decision=row.reason;if(typeof row.status==='string')p.status=row.status;}}
  }
  private counts():void{
    try{this.run.counts.files=this.app.vault.getFiles().length;}catch{if(!this.run.unavailable.includes('file-count'))this.run.unavailable.push('file-count');}
    try{let tabs=0,deferred=0;this.app.workspace.iterateAllLeaves(leaf=>{tabs++;if(leaf.isDeferred===true)deferred++;});this.run.counts.tabs=tabs;this.run.counts.deferredTabs=deferred;}catch{if(!this.run.unavailable.includes('tab-count'))this.run.unavailable.push('tab-count');}
  }
  private tick():void{
    if(this.stopped||this.finished)return;this.checkUI();const now=this.runtime.now(),state=this.readState(),fast=isRecord(state.fastStart)?state.fastStart:null,queue=record(state.startup);
    this.capture('periodic',state);
    const fastDone=!fast||['verified','normal','unsupported','failed'].includes(String(fast.phase));
    const pluginsDone=this.activePluginLoads===0&&![queue.pending,queue.loading].some(list=>Array.isArray(list)&&list.length>0);
    if(pluginsDone&&this.run.milestones.uiReadyMs!==null)this.run.milestones.pluginsSettledMs??=round(now);
    // A quiet window avoids completing between early metadata events and
    // native plugin loads. New metadata events restart that window too.
    const ready=this.run.milestones.uiReadyMs!==null&&fastDone&&pluginsDone&&this.metadataSeen&&this.activeActions===0;
    const latest=Math.max(this.run.milestones.metadataResolvedMs??0,this.run.milestones.pluginsSettledMs??0);
    if(ready){this.stableSince??=now;if(now-Math.max(this.stableSince,latest)>=1500){this.run.status='complete';this.run.milestones.settledMs=round(now);this.finish();return;}}else this.stableSince=null;
    if(now-this.bootStart>=180000){this.run.status='timeout';if(!this.metadataSeen)this.run.unavailable.push('metadata-resolved-not-observed');this.finish();return;}
    // Do not parse or serialize history on the startup critical path.
    if(this.run.milestones.uiReadyMs!==null&&now-this.checkpointAt>=10000){this.counts();this.persist();this.checkpointAt=now;}this.schedule(1000);
  }
  private finish():void{
    this.finished=true;this.runtime.cancel(this.timer);
    this.capture('final');this.counts();
    this.persist();this.detach();
  }
  private persist():void{if(this.run.kind!=='startup')return;try{const value=JSON.stringify(this.run);if(value!==this.lastSaved){this.store.save(this.run);this.lastSaved=value;}}catch{/* Storage full/unavailable never blocks startup. */}}
  private detach():void{for(const dispose of this.disposers.reverse())try{dispose();}catch{/* A later wrapper may still own the method. */}this.disposers=[];}
  dispose():void{if(this.stopped)return;if(!this.finished){this.run.status='interrupted';this.capture('unload');this.run.observation!.interruption='unload';if(this.run.milestones.uiReadyMs!==null)this.counts();this.persist();}this.stopped=true;this.runtime.cancel(this.timer);this.detach();}
}
function round(n:number):number{return Math.round(n*10)/10;}
