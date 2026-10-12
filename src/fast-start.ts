import { Scope, inside, normalizeScope, scopeKey, selected } from './target';
import { IdleScheduler } from './scheduler';
import { compatibleInventory, supportsAndroidAdapter } from './compatibility';
import { VerificationQueue } from './verification-queue';
import {japanese,MessageKey,Translator} from './i18n';
import {patchMethods,MethodPatch} from './method-patch';
import {AndroidInventoryAdapter,CachedEntry,isAndroidInventoryAdapter} from './android-adapter';
import {record,isRecord,isMethod} from './runtime';
export interface Entry { name:string; type:'file'|'directory'; ctime?:number; mtime?:number; size?:number; }
export interface Snapshot { version:2; api:string; root:string; scope:Scope; entries:Entry[]; normalScanMs?:number; }
export interface FastPort {
  api:string; adapter:unknown; scope:Scope; mode?:'auto'|'always'; scheduler?:IdleScheduler; text?:Translator;
  load():unknown; save(snapshot:Snapshot):void; changed(message:string):void;
  defer(callback:()=>void,ms:number):unknown;
  ready?():Promise<void>; startup?():boolean; beforeRecognize?():void;
}
const visible=(p:string)=>p.split('/').every(s=>s&&!s.startsWith('.')&&!['__proto__','constructor','prototype','hasOwnProperty'].includes(s));
// Symbol.for also survives plugin module reloads. A draining/failed owner must
// keep its guards without a second instance nesting another provisional scan.
const inventoryOwner=Symbol.for('boot-booster.inventory-owner.v1');
function validEntry(value:unknown):value is Entry {
  const e=record(value);
  return !!e&&typeof e.name==='string'&&visible(e.name)&&!e.name.includes('\\')&&e.name===e.name.normalize('NFC')&&
    (e.type==='directory'||(e.type==='file'&&[e.ctime,e.mtime,e.size].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)));
}
export function validSnapshot(value:unknown,root:string,scope:Scope,api:string):value is Snapshot {
  if(!isRecord(value)||!isRecord(value.scope)||!Array.isArray(value.scope.folders)||!value.scope.folders.every((p:unknown)=>typeof p==='string'))return false;
  const s=value as unknown as Snapshot;
  if(!s||s.version!==2||s.root!==root||!compatibleInventory(s.api,api)||!s.scope||!Array.isArray(s.scope.folders)||typeof s.scope.all!=='boolean'||scopeKey(s.scope)!==scopeKey(scope)||!Array.isArray(s.entries)||s.entries.length>100000)return false;
  const kinds=new Map<string,string>();
  for(const e of s.entries){if(!validEntry(e)||!selected(e.name,scope)||kinds.has(e.name))return false;kinds.set(e.name,e.type);}
  for(const e of s.entries){const parent=e.name.slice(0,e.name.lastIndexOf('/'));if(e.name.includes('/')&&!(scope.folders.includes(e.name)&&e.type==='directory')&&kinds.get(parent)!=='directory')return false;}
  return scope.all||scope.folders.every(p=>kinds.get(p)==='directory');
}
/** All disk operations owned by the scanner are reads. Mutations only delegate user/plugin requests. */
export class FastStart {
  phase:'unsupported'|'normal'|'provisional'|'reconciling'|'verified'|'failed'='normal';
  reasonKey:MessageKey|''='';reasonArgs:Record<string,string|number>={};
  get reason():string{return this.reasonKey?(this.port.text??japanese)(this.reasonKey,this.reasonArgs):'';}
  seeded=0;scanned=0;provisionalAtMs:number|null=null;verifiedAtMs:number|null=null;
  pointStats=0;pointStatMs=0;pointQueueWaitMs=0;startupPointStats=0;foregroundStatReuses=0;cacheLoadMs=0;seedMs=0;
  inventoryMs:number|null=null;
  readonly progress={stage:'idle',path:'',nativePending:false};
  get normalInventoryMs():number|null{return typeof this.normalScanMs==='number'&&this.normalScanMs>=0?this.normalScanMs:null;}
  readonly background={startedAtMs:null as number|null,watchMs:0,indexMs:0,directories:0,nativeListMs:0,queueWaitMs:0,applyMs:0,unchanged:0,updated:0,missingChecks:0};
  startupCalls=0;cacheState:'unread'|'missing'|'invalid'|'loaded'|'unavailable'='unread';
  readonly scheduler:IdleScheduler;
  private a!:AndroidInventoryAdapter;private scope:Scope;private snapshot:Snapshot|null=null;private normalScanMs?:number;
  private patches:MethodPatch[]=[];private undo:(()=>void)|null=null;
  private reconciliation:Promise<void>|null=null;private stopped=false;
  private disposed=false;private disposal:Promise<void>|null=null;private installed=false;
  private starting:Promise<void>|null=null;
  private changes=new Map<string,number>();private touched=new Set<string>();private revision=0;
  private inflight=new Map<string,number>();
  recognizing:string|null=null;
  private points=new Map<string,{promise:Promise<void>;allowConfirmed:boolean;foreground:boolean;fresh:boolean}>();private seedDone=Promise.resolve();private finishSeed=()=>{};
  private pointQueue=new VerificationQueue();
  private inventoryReady=false;private captureScheduled=false;
  private snapshotLoaded=false;
  private confirmed=new Map<string,{signature:string;revision:number;foregroundToken?:object}>();
  private children:Map<string,Set<string>>|null=null;
  private parent(path:string):string{return path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';}
  private indexChild(path:string):void{if(!this.children||path==='/')return;const parent=this.parent(path);let children=this.children.get(parent);if(!children)this.children.set(parent,children=new Set());children.add(path);}
  constructor(private port:FastPort){this.scope=normalizeScope(port.scope);this.scheduler=port.scheduler??new IdleScheduler();}
  install():boolean {
    const candidate=this.port.adapter;
    if(this.disposed)return false;
    if(this.installed)return true;
    if(isRecord(candidate)&&Reflect.get(candidate,inventoryOwner)){this.phase='unsupported';this.report('previousScan');return false;}
    if(!supportsAndroidAdapter(this.port.api)){this.phase='unsupported';this.report('unsupportedApi',{api:this.port.api});return false;}
    if(!this.scope.all&&!this.scope.folders.length){this.phase='unsupported';this.report('emptyScope');return false;}
    if(!isAndroidInventoryAdapter(candidate)){this.phase='unsupported';this.report('missingApi');return false;}
    const a=this.a=candidate;
    try{Object.defineProperty(a,inventoryOwner,{value:this,configurable:true});}catch{this.phase='unsupported';this.report('ownerFailed');return false;}
    this.installed=true;
    const original=a.watchAndList;
    const startInventory=async(...args:unknown[])=>{
      const inventoryStart=performance.now();
      this.startupCalls++;
      if(!this.snapshotLoaded){this.snapshotLoaded=true;const start=performance.now();
        try{const s=this.port.load();this.cacheState=s?'invalid':'missing';if(validSnapshot(s,a.basePath,this.scope,this.port.api)){
          this.cacheState='loaded';this.snapshot=s;
          // Inventory compatibility does not imply the new app has the same
          // native scan performance. Auto mode measures it again after an update.
          if(s.api===this.port.api&&Number.isFinite(s.normalScanMs))this.normalScanMs=s.normalScanMs;
        }}catch{this.cacheState='unavailable';}
        this.cacheLoadMs=performance.now()-start;
      }
      if(this.stopped||!this.snapshot||this.phase!=='normal'||(this.port.mode==='auto'&&(this.normalScanMs===undefined||this.normalScanMs<2500||this.snapshot.entries.length<1000))){
        this.progress.stage='normal-reading';const start=performance.now();await original.apply(a,args);this.normalScanMs=performance.now()-start;this.inventoryMs=performance.now()-inventoryStart;this.progress.stage='done';this.inventoryReady=true;this.report('ready');this.contentChanged();return;
      }
      let live:Entry[];
      try {live=await this.readOutside('');if(!this.scope.all&&this.scope.folders.some(p=>!live.some(e=>e.name===p&&e.type==='directory')))throw Error('Target unavailable');}
      catch{this.progress.stage='normal-reading';const start=performance.now();await original.apply(a,args);this.normalScanMs=performance.now()-start;this.inventoryMs=performance.now()-inventoryStart;this.progress.stage='done';this.inventoryReady=true;this.report('normalStartup');this.contentChanged();return;}
      // Unload may happen while the root enumeration is in native code. Finish
      // with the original scanner; never seed after its guards were retired.
      if(this.disposed||this.stopped){await original.apply(a,args);return;}
      this.phase='provisional';this.provisionalAtMs=performance.now();this.seedDone=new Promise(r=>this.finishSeed=r);
      try {
        const start=performance.now();
        a.files={'/':{type:'folder',realpath:'/'}};
        const fresh=new Set(live.map(e=>e.name));const roots=new Set(live.filter(e=>e.type==='directory').map(e=>e.name));
        const cached=this.snapshot.entries.filter(e=>!fresh.has(e.name)&&(!this.scope.all||roots.has(e.name.split('/')[0])));
        const entries=[...live,...cached];
        // Only directories need topological ordering. Do not repeatedly split every
        // file path inside an N log N sort comparator on the startup thread.
        const directories=entries.filter(e=>e.type==='directory').map(e=>({entry:e,depth:e.name.split('/').length}));
        directories.sort((x,y)=>x.depth-y.depth);
        for(const {entry} of directories)a.quickList('',entry);
        for(const e of entries)if(e.type==='file')a.quickList('',e);
        this.seedMs=performance.now()-start;
        this.inventoryMs=performance.now()-inventoryStart;this.progress.stage='waiting';
        this.seeded=cached.length;this.report('background');
      }catch(e){this.phase='failed';this.report('seedFailed');throw e;}finally{this.finishSeed();}
      this.port.defer(()=>{void this.verify().catch(()=>{});},2000);
    };
    this.wrap('watchAndList',(...args:unknown[])=>{
      if(this.starting)return this.starting;
      const task=this.starting=startInventory(...args);const finish=()=>{if(this.starting===task)this.starting=null;};
      void task.then(finish,finish);return task;
    });
    const onChange=a.onFileChange;
    this.wrap('onFileChange',(path:string,...args:unknown[])=>{if(this.pending())this.mark(path);return onChange.apply(a,[path,...args]);});
    for(const name of ['read','readBinary','stat','exists','list','write','writeBinary','append','appendBinary','process','mkdir','rmdir','remove','trashSystem','trashLocal','rename','copy']){
      const originalMethod=record(a)[name];if(!isMethod(originalMethod))continue;
      this.wrap(name,async(...args:unknown[])=>{
        if(!this.pending())return originalMethod.apply(a,args);
        const paths=(name==='rename'||name==='copy'?args.slice(0,2):args.slice(0,1)) as string[];
        const mutation=!['read','readBinary','stat','exists','list'].includes(name);
        if(this.pending()){
          if(paths.some(p=>typeof p!=='string'||p.includes('\\')||(p!==''&&p!=='/'&&p.split('/').some(s=>!s||s==='..'||s==='.'||['__proto__','constructor','prototype','hasOwnProperty'].includes(s)))))throw this.error('invalidPath');
          const hidden=(p:string)=>p.split('/').some(s=>s.startsWith('.'));
          // Configuration is not seeded. Keep settings and disable/save usable
          // even after content verification fails; validate paths first.
          if(paths.every(hidden))return originalMethod.apply(a,args);
          if(this.phase==='failed')throw this.error('verificationFailed');
          if(mutation&&(paths.some(p=>p===''||p==='/'||hidden(p))))throw this.error('pendingOperation');
          // Adapter reads include dependencies of foreground views and startup
          // indexing. Waiting for idle here can deadlock a held foreground view.
          // Only our own background scanner waits for idle.
          const destructive=['rmdir','remove','trashSystem','trashLocal','rename','copy'].includes(name);
          if(destructive&&a.files[paths[0]]?.type==='folder'){void this.verify().catch(()=>{});throw this.error('pendingOperation');}
          const approved=mutation?new Map<string,string>():null;
          for(const raw of paths){const path=raw==='/'?'':raw;if(path&&!visible(path))continue;const before=this.signature(a.files[path]);
            const token=this.scheduler.foregroundToken(path);
            // Reuse the preflight only inside this foreground operation. A new
            // open, watcher revision or any mutation still requires a fresh stat.
            const sameOperation=!!token&&this.confirmed.get(path)?.foregroundToken===token;
            await this.ensurePath(path,!mutation&&(!this.scheduler.isPriority(path)||sameOperation));
            if(name==='list')await this.scanDirectory(path,false,[]);
            if(mutation&&before!==this.signature(a.files[path]))throw this.error('externalChange');
            approved?.set(path,before);
          }
          // Native stat can return its old result after a watcher notification.
          // Also recheck the source after awaiting a rename/copy destination.
          // This is an in-memory fence; normal mutations add no further disk I/O.
          if(approved&&this.pending())for(const [path,signature] of approved){
            const confirmed=this.confirmed.get(path);
            if(!confirmed||this.newer(path,confirmed.revision)||confirmed.signature!==signature||this.signature(a.files[path])!==signature)throw this.error('externalChange');
          }
          if(['rename','copy'].includes(name)&&a.files[paths[1]])throw this.error('existingDestination');
          if(mutation)for(const path of paths)this.mark(path);
        }
        const tracked=this.pending()&&mutation;
        if(tracked)for(const path of paths)this.inflight.set(path,(this.inflight.get(path)??0)+1);
        try{return await originalMethod.apply(a,args);}finally{if(tracked)for(const path of paths){this.inflight.set(path,(this.inflight.get(path)??1)-1);this.mark(path);}}
      });
    }
    // Do not expose cached entries unless every installed read/write guard can
    // be applied. A failed hook must leave the native inventory path intact.
    this.undo=patchMethods(this.patches);this.patches=[];
    if(!this.undo){this.installed=false;if(a[inventoryOwner]===this)delete a[inventoryOwner];this.phase='unsupported';this.report('missingApi');return false;}
    return true;
  }
  private signature(e:CachedEntry|undefined):string {return e?JSON.stringify([e.type,e.realpath,e.mtime,e.size]):'absent';}
  private pending():boolean{return this.phase==='provisional'||this.phase==='reconciling'||this.phase==='failed';}
  private mark(path:string):void {this.changes.set(path,++this.revision);this.touched.add(path);}
  private newer(path:string,fence:number):boolean {for(let p=path;p;p=p.includes('/')?p.slice(0,p.lastIndexOf('/')):'')if((this.changes.get(p)??0)>fence||(this.inflight.get(p)??0)>0)return true;return false;}
  private async readOutside(path:string):Promise<Entry[]> {
    const entries=await this.directory(path);const result=[...entries];
    for(const e of entries)if(e.type==='directory'&&!selected(e.name,this.scope))result.push(...await this.readOutside(e.name));
    return result;
  }
  private async directory(path:string,background=false):Promise<Entry[]> {
    const start=performance.now();let raw:unknown;
    if(background){this.progress.stage='listing';this.progress.path=path;this.progress.nativePending=true;}
    try{raw=await this.a.fs.readdir(this.a.getFullRealPath(path));}finally{if(background){this.progress.nativePending=false;this.progress.stage='comparing';}}
    if(background){this.background.directories++;this.background.nativeListMs+=performance.now()-start;}
    if(!Array.isArray(raw))throw Error('Invalid directory response');
    const entries:Entry[]=[];const names=new Set<string>();
    for(let i=0;i<raw.length;i++){if(background&&i%64===0)await this.scheduler.checkpoint();const child=record(raw[i]);if(typeof child.name!=='string'||child.name.includes('/')||child.name.includes('\\'))throw Error('Invalid child path');
      const e={...child,name:path?path+'/'+child.name:child.name};if(!visible(e.name))continue;
      if(!validEntry(e)||names.has(e.name))throw Error('Invalid directory entry');names.add(e.name);entries.push(e);}
    return entries;
  }
  /** Foreground reads verify only the requested file and its ancestors. */
  ensurePath(path:string,allowConfirmed=false,foreground=this.scheduler.isPriority(path)||this.scheduler.hasForeground()):Promise<void>{
    if(!this.pending())return Promise.resolve();if(this.phase==='failed')return Promise.reject(Error('File verification failed'));
    if(path==='/'||path==='')return Promise.resolve();
    const confirmed=this.confirmed.get(path);
    if(allowConfirmed&&confirmed&&!this.newer(path,confirmed.revision)&&confirmed.signature===this.signature(this.a.files[path])){if(confirmed.foregroundToken&&confirmed.foregroundToken===this.scheduler.foregroundToken(path))this.foregroundStatReuses++;return Promise.resolve();}
    const existing=this.points.get(path);if(existing){
      // A queued read must never allow a later mutation to skip its fresh stat.
      existing.allowConfirmed=existing.allowConfirmed&&allowConfirmed;
      if(foreground)for(let p=path;p;p=this.parent(p)){
        const ancestor=this.points.get(p);if(ancestor)ancestor.foreground=true;this.pointQueue.prioritize(p);
      }
      return allowConfirmed?existing.promise:existing.promise.then(()=>existing.fresh?undefined:this.ensurePath(path,false,foreground));
    }
    const check={promise:Promise.resolve(),allowConfirmed,foreground,fresh:false};
    check.promise=this.checkPath(path,check).finally(()=>this.points.delete(path));this.points.set(path,check);return check.promise;
  }
  private async checkPath(path:string,check:{allowConfirmed:boolean;foreground:boolean;fresh:boolean}):Promise<void>{
    await this.seedDone;
    const parent=path.includes('/')?path.slice(0,path.lastIndexOf('/')):'';
    if(parent)await this.ensurePath(parent,true,check.foreground);
    const queuedAt=performance.now();
    await this.pointQueue.enqueue(path,check.foreground,()=>this.a.queue(async()=>{
      this.pointQueueWaitMs+=performance.now()-queuedAt;
      this.assertHealthy();
      // The background inventory may have confirmed this file while its point
      // check was waiting. Only read-only callers may reuse that confirmation.
      const confirmed=this.confirmed.get(path);
      if(check.allowConfirmed&&confirmed&&!this.newer(path,confirmed.revision)&&confirmed.signature===this.signature(this.a.files[path]))return;
      const before=this.signature(this.a.files[path]),fence=this.revision;let entry:Entry|null;
      const startedAt=performance.now();
      try {check.fresh=true;this.pointStats++;if(this.port.startup?.())this.startupPointStats++;const raw=await this.a.fs.stat(this.a.getFullRealPath(this.a.getRealPath(path))),candidate={...record(raw),name:this.a.getRealPath(path)};if(!validEntry(candidate))throw Error('Invalid stat');entry=candidate;}
      catch(e){if(record(e).code!=='ENOENT')throw e;entry=null;}
      finally{this.pointStatMs+=performance.now()-startedAt;}
      this.assertHealthy();
      const invalidated=this.newer(path,fence);
      if(entry)this.apply(entry);else this.removeCached(path);
      const changed=before!==this.signature(this.a.files[path]);
      if(changed||entry?.type==='file')this.changes.set(path,++this.revision);
      if(changed&&entry?.type==='directory')this.touched.add(path);
      // A watcher event during native I/O must not become part of a reusable
      // confirmation. The following read checks again, even in the same open.
      if(invalidated)this.confirmed.delete(path);
      else this.confirmed.set(path,{signature:this.signature(this.a.files[path]),revision:this.revision,foregroundToken:this.scheduler.foregroundToken(path)});
    }));
  }
  verify():Promise<void>{
    if(this.phase==='failed')return Promise.reject(Error('File verification failed; restart required'));
    if(this.reconciliation)return this.reconciliation;if(!this.pending())return Promise.resolve();
    this.reconciliation=this.scan();void this.reconciliation.catch(()=>{});return this.reconciliation;
  }
  private assertHealthy():void {if(this.phase==='failed')throw Error('File verification failed; restart required');}
  private async scan():Promise<void>{
    try{
      await this.seedDone;this.progress.stage='waiting-layout';await this.port.ready?.();this.phase='reconciling';this.progress.stage='waiting';await this.scheduler.idle();this.background.startedAtMs=performance.now();
      // watch() is the adapter's native watcher setup without a full stat-all request.
      this.progress.stage='watching';this.progress.nativePending=true;const watchAt=performance.now();
      try{await this.a.fs.watch(this.a.basePath);}finally{this.background.watchMs+=performance.now()-watchAt;this.progress.nativePending=false;this.progress.stage='indexing';}
      // One linear inventory pass, instead of scanning every file for every folder.
      const indexAt=performance.now();this.children=new Map();const inventory=Object.keys(this.a.files);for(let i=0;i<inventory.length;i++){if(i%128===0)await this.scheduler.checkpoint();this.indexChild(inventory[i]);}this.background.indexMs+=performance.now()-indexAt;
      const queue=[''];
      for(let head=0;head<queue.length;head++){await this.scheduler.checkpoint();await this.scanDirectory(queue[head],true,queue);}
      queue.length=0;
      for(;;){while(this.touched.size){await this.scheduler.checkpoint();const paths=[...this.touched];this.touched.clear();
        for(const p of paths){if(!visible(p))continue;await this.scheduler.checkpoint();await this.ensurePath(p);if(this.a.files[p]?.type==='folder')queue.push(p);}
        for(let head=0;head<queue.length;head++){await this.scheduler.checkpoint();await this.scanDirectory(queue[head],true,queue);}queue.length=0;
      }
      // The final yield is an event boundary too. Do not discard notifications
      // or finish while a delegated mutation is still in flight.
      this.progress.stage='finishing';await this.scheduler.idle();if(this.stopped)return;
      if(!this.touched.size&&!this.points.size&&![...this.inflight.values()].some(count=>count>0))break;
      }
      this.phase='verified';this.progress.stage='done';this.progress.path='';this.inventoryReady=true;this.verifiedAtMs=performance.now();this.report('ready');this.contentChanged();
      this.confirmed.clear();this.changes.clear();this.inflight.clear();this.children=null;
    }catch(e){if(this.stopped)return;this.phase='failed';this.progress.stage='failed';this.report('verificationFailed');throw e;}
  }
  private async scanDirectory(path:string,background:boolean,queue:string[]):Promise<void>{
    const fence=this.revision;let entries:Entry[];
    try{entries=await this.directory(path,background);}catch(e){if(path&&record(e).code==='ENOENT'){await this.ensurePath(path);return;}throw e;}
    const names=new Set(entries.map(e=>e.name));
    for(let i=0;i<entries.length;i+=64){if(background)await this.scheduler.checkpoint();const batch=entries.slice(i,i+64),queuedAt=performance.now();
      // Confirm unchanged entries without joining Obsidian's content I/O queue.
      // This only updates our read-verification map, never the Vault inventory.
      // Changed entries still use the adapter queue and recheck the revision fence.
      const changed:Entry[]=[];const comparedAt=performance.now();
      for(const e of batch){if(!this.newer(e.name,fence)){
        if(this.matches(e)){this.confirmed.set(e.name,{signature:this.signature(this.a.files[e.name]),revision:this.revision});if(background)this.background.unchanged++;}
        else changed.push(e);
      }if(e.type==='directory')queue.push(e.name);this.scanned++;}
      if(background)this.background.applyMs+=performance.now()-comparedAt;
      if(!changed.length)continue;
      await this.a.queue(()=>{const start=performance.now();if(background)this.background.queueWaitMs+=start-queuedAt;
        for(const e of changed)if(!this.newer(e.name,fence)){const updated=this.apply(e);if(background){if(updated)this.background.updated++;else this.background.unchanged++;}this.confirmed.set(e.name,{signature:this.signature(this.a.files[e.name]),revision:this.revision});}
        if(background)this.background.applyMs+=performance.now()-start;
      });
    }
    const candidates=this.children?(this.children.get(path)??[]):Object.keys(this.a.files).filter(p=>p!=='/'&&this.parent(p)===path);
    const missing=[...candidates].filter(p=>!names.has(p)&&this.a.files[p]);
    for(const p of missing){if(background){await this.scheduler.checkpoint();this.background.missingChecks++;}await this.ensurePath(p);}
  }
  private matches(e:Entry):boolean {
    const old=this.a.files[e.name],type=e.type==='directory'?'folder':'file';
    return old?.type===type&&old.realpath===e.name&&(type==='folder'||(old.mtime===Math.round(e.mtime!)&&old.size===e.size));
  }
  private apply(e:Entry):boolean {
    this.indexChild(e.name);
    const old=this.a.files[e.name],type=e.type==='directory'?'folder':'file';
    if(this.matches(e))return false;
    if(old&&old.type!==type)this.removeCached(e.name);
    this.port.beforeRecognize?.();
    const previous=this.recognizing;this.recognizing=e.name;
    try{this.a.quickList('',e);}finally{this.recognizing=previous;}
    return true;
  }
  private removeCached(path:string):void {
    if(this.a.files[path]?.type==='file'){this.a.removeFile(path);return;}
    for(const p of Object.keys(this.a.files).filter(p=>inside(p,path)).sort((a,b)=>b.length-a.length))this.a.removeFile(p);
  }
  private capture():void {
    try{
      const entries:Entry[]=Object.entries(this.a.files).filter((row):row is [string,CachedEntry]=>!!row[1]&&row[0]!=='/'&&selected(row[0],this.scope)&&visible(row[0])).map(([,v])=>v.type==='folder'?{name:v.realpath,type:'directory'}:{name:v.realpath,type:'file',ctime:v.ctime,mtime:v.mtime,size:v.size});
      const s:Snapshot={version:2,api:this.port.api,root:this.a.basePath,scope:this.scope,entries,normalScanMs:this.normalScanMs};
      if(validSnapshot(s,this.a.basePath,this.scope,this.port.api)){this.port.save(s);this.snapshot=s;}
    }catch{this.report('snapshotFailed');}
  }
  contentChanged():void {
    if(!this.inventoryReady||this.pending()||this.captureScheduled||this.stopped||this.disposed)return;
    this.captureScheduled=true;
    this.port.defer(()=>{void (async()=>{try{await this.port.ready?.();await this.scheduler.idle();if(!this.stopped&&!this.pending())this.capture();}catch{/* Retired background work does not save a snapshot. */}finally{this.captureScheduled=false;}})();},3000);
  }
  private wrap(name:string,wrapped:MethodPatch['replacement']):void {this.patches.push({host:this.a,name,replacement:wrapped});}
  dispose():Promise<void> {
    if(this.disposal)return this.disposal;this.disposed=true;
    if(this.starting){this.disposal=this.starting.then(()=>this.retireInventory(),()=>this.retireInventory());return this.disposal;}
    this.disposal=this.retireInventory();return this.disposal;
  }
  private retireInventory():Promise<void>{
    if(this.pending()&&this.phase!=='failed'){
      this.scheduler.drain();return this.verify().then(()=>this.unpatch(),()=>{this.scheduler.stop();});
    }else{if(this.phase==='failed')this.scheduler.stop();else this.unpatch();}
    // A failed provisional inventory retains its read/write guards until the
    // app restarts. It is never silently repaired or admitted to a new owner.
    return Promise.resolve();
  }
  private unpatch():void {this.stopped=true;this.scheduler.stop();this.undo?.();this.undo=null;if(this.a?.[inventoryOwner]===this)delete this.a[inventoryOwner];}
  private error(key:MessageKey):Error{return Error('Boot Booster: '+(this.port.text??japanese)(key));}
  private report(key:MessageKey,values:Record<string,string|number>={}):void {this.reasonKey=key;this.reasonArgs=values;if(!this.disposed)this.port.changed(this.reason);}
}
