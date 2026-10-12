import {test} from 'node:test';import assert from 'node:assert/strict';
import {BenchmarkStore,StartupRecorder,measureDefaults,HISTORY_LIMIT} from '../src/benchmark';
function fixture(ready=false){
  let now=100,callbacks:(()=>void)[]=[],changed=()=>{};const tasks=new Map<number,()=>void>();let seq=0,writes=0,loading=true;
  const data=new Map<string,string>(),store=new BenchmarkStore({getItem:k=>data.get(k)??null,setItem:(k,v)=>{writes++;data.set(k,v);},removeItem:k=>{data.delete(k);}},'SECRET-ROOT');
  const events=new Map<string,()=>void>(),workspace:any={layoutReady:ready,onLayoutReady:(fn:()=>void)=>{callbacks.push(fn);},async loadLayout(){now+=300;},iterateAllLeaves:(visit:any)=>{visit({isDeferred:false});visit({isDeferred:true});}};
  const app:any={workspace,vault:{async load(){now+=200;},getFiles:()=>[{path:'SECRET-NOTE'}]},metadataCache:{async initialize(){now+=100;},on:(key:string,fn:()=>void)=>{events.set(key,fn);return key;},offref:(key:string)=>events.delete(key)},plugins:{enabledPlugins:new Set(['early','later']),plugins:{early:{}},manifests:{early:{version:'1'},later:{version:'2'}},loadPlugin(id:string){now+=50;return Promise.resolve(id);}}};
  const recorder=new StartupRecorder(app,store,{api:'1.14.4'},measureDefaults(),{now:()=>now,wall:()=>1700000000000+now,origin:1700000000000,later:fn=>{const id=++seq;tasks.set(id,fn);return id;},cancel:id=>{if(id!==undefined)tasks.delete(id);},loading:()=>loading,watchLoading:fn=>{changed=fn;return ()=>{changed=()=>{};};}});
  let state:any={fastStart:{phase:'provisional',reason:'SECRET-PATH'},startup:{pending:['later'],loading:[],plugins:[]}};
  return {recorder,store,app,data,tasks,events,writes:()=>writes,setState:(value:any)=>{state=value;},install:()=>{recorder.install();recorder.configure({scope:{all:true,folderCount:0}},()=>state);},ready:()=>{workspace.layoutReady=true;callbacks.forEach(fn=>fn());},show:()=>{loading=false;changed();},resolved:()=>events.get('resolved')?.(),advance:(ms:number)=>{now+=ms;const due=[...tasks.values()];tasks.clear();due.forEach(fn=>fn());},now:()=>now};
}
test('records actual phase timings and return values without persisting on the startup critical path',async()=>{const f=fixture();f.install();const result=f.app.plugins.loadPlugin('later');assert.equal(await result,'later');await f.app.vault.load();await f.app.metadataCache.initialize();await f.app.workspace.loadLayout();f.recorder.onloadFinished();assert.equal(f.writes(),0);assert.equal(f.recorder.run.phases.readingFiles[0].durationMs,200);assert.equal(f.recorder.run.phases.loadingMetadata[0].durationMs,100);assert.equal(f.recorder.run.phases.workspaceLayout[0].durationMs,300);assert.equal(f.recorder.run.plugins.later.loads[0].durationMs,50);assert.equal(f.recorder.run.plugins.early.beforeRecorder,true);assert.deepEqual(f.recorder.run.plugins.early.loads,[]);f.recorder.dispose();});
test('UI readiness waits for both layout and the loading overlay; background completion stays separate',()=>{const f=fixture();f.install();f.ready();assert.equal(f.recorder.run.milestones.uiReadyMs,null);f.advance(100);f.show();assert.equal(f.recorder.run.milestones.uiReadyMs,200);f.resolved();f.advance(2000);assert.equal(f.recorder.run.status,'in-progress');f.setState({fastStart:{phase:'verified',verifiedAtMs:1500},startup:{pending:[],loading:[],plugins:[]}});f.advance(1000);f.advance(2000);assert.equal(f.recorder.run.status,'complete');assert.equal(f.recorder.run.counts.files,1);assert.equal(f.recorder.run.counts.tabs,2);assert.equal(f.recorder.run.counts.deferredTabs,1);assert.equal(f.recorder.run.milestones.verificationMs,1500);assert.equal(f.tasks.size,0);assert.equal(f.events.size,0);});
test('a late metadata event resets the quiet window instead of prematurely completing',()=>{const f=fixture();f.install();f.ready();f.show();f.setState({});f.resolved();f.advance(1000);f.advance(1000);f.resolved();f.advance(500);assert.equal(f.recorder.run.status,'in-progress');f.advance(2000);assert.equal(f.recorder.run.status,'complete');});
test('missing events time out as incomplete and the final report explains missing capabilities',()=>{const f=fixture();delete f.app.metadataCache.on;delete f.app.vault.load;f.install();f.ready();f.show();f.setState({});f.advance(180001);assert.equal(f.recorder.run.status,'timeout');assert.ok(f.recorder.run.unavailable.includes('resolved'));assert.ok(f.recorder.run.unavailable.includes('readingFiles'));assert.equal(f.recorder.run.milestones.settledMs,null);assert.equal(f.store.history()[0].status,'timeout');});
test('interruption, foreground activity and hiding are recorded without any key or path data',()=>{const f=fixture();f.install();f.recorder.interaction();f.recorder.interaction();f.recorder.interaction(true);f.advance(1000);f.recorder.dispose();assert.equal(f.recorder.run.status,'interrupted');assert.equal(f.recorder.run.interaction.events,2);assert.equal(f.recorder.run.interaction.hidden,true);const json=f.store.export(f.recorder.run);assert.ok(!json.includes('SECRET'));assert.equal(JSON.parse(json).runs.length,1);});
test('same-run checkpoints replace entries and history keeps only the last 20 runs',()=>{const f=fixture();for(let i=0;i<30;i++)f.store.save({...f.recorder.run,id:String(i)});assert.equal(f.store.history().length,HISTORY_LIMIT);assert.equal(f.store.history()[0].id,'10');f.store.save({...f.recorder.run,id:'29',status:'complete'});assert.equal(f.store.history().length,HISTORY_LIMIT);assert.equal(f.store.history().at(-1)?.status,'complete');const parsed=JSON.parse(f.store.export());assert.equal(parsed.schema,'boot-booster-startup-benchmark/v1');assert.equal(parsed.runs.length,20);f.store.clear();assert.deepEqual(f.store.history(),[]);});
test('runtime enablement does not become a new cold-start record',()=>{const f=fixture(true);f.install();f.recorder.dispose();assert.equal(f.recorder.run.kind,'late-load');assert.equal(f.store.history().length,0);assert.equal(JSON.parse(f.store.export(f.recorder.run)).runs.length,0);});
test('observer preserves promise identity, rejection, receiver and arguments',async()=>{const f=fixture(),error=Error('native failure'),args:any[]=[];let receiver:any;const promise=Promise.reject(error);f.app.vault.load=function(...a:any[]){receiver=this;args.push(...a);return promise;};f.install();assert.equal(f.app.vault.load('arg'),promise);await assert.rejects(promise,e=>e===error);await Promise.resolve();assert.equal(receiver,f.app.vault);assert.deepEqual(args,['arg']);assert.equal(f.recorder.run.phases.readingFiles[0].ok,false);f.recorder.dispose();});
test('completion restores observers without overwriting wrappers installed later',()=>{const f=fixture(),original=f.app.vault.load;f.install();const native=f.app.workspace.loadLayout;const later=()=>native.call(f.app.workspace);f.app.workspace.loadLayout=later;f.recorder.dispose();assert.equal(f.app.vault.load,original);assert.equal(f.app.workspace.loadLayout,later);});
test('corrupt history or storage failure cannot crash startup measurement',()=>{const f=fixture();f.data.set(f.store.historyKey,'invalid');assert.deepEqual(f.store.history(),[]);f.install();f.data.set(f.store.historyKey,'{}');f.recorder.dispose();assert.equal(f.store.history().length,1);const unavailable=new BenchmarkStore({getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('full');},removeItem:()=>{}},'x');assert.deepEqual(unavailable.preferences(),measureDefaults());const recorder=new StartupRecorder(f.app,unavailable,{},measureDefaults(),{now:()=>100,wall:()=>100,origin:1,later:()=>0,cancel:()=>{}});assert.doesNotThrow(()=>recorder.dispose());});

test('malformed stored rows cannot reach the history table or comparison code',()=>{
 const f=fixture(),valid=f.recorder.run;
 for(const change of [{phases:{readingFiles:[null]}},{plugins:{broken:{loads:'bad'}}},{milestones:[]},{counts:{files:'bad'}},{uiReadyState:{hidden:false}},{interaction:{firstMs:null,events:0}}]){
  f.data.set(f.store.historyKey,JSON.stringify([valid,{...valid,id:'broken',...change}]));
  assert.deepEqual(f.store.history().map(r=>r.id),[valid.id]);assert.doesNotThrow(()=>f.store.export());
 }
});

test('unpatchable recording methods leave native startup and other observations available',async()=>{
 const f=fixture(),native=f.app.vault.load;Object.defineProperty(f.app.vault,'load',{writable:false});
 assert.doesNotThrow(()=>f.install());assert.equal(f.app.vault.load,native);assert.ok(f.recorder.run.unavailable.includes('readingFiles'));
 await f.app.workspace.loadLayout();assert.equal(f.recorder.run.phases.workspaceLayout.length,1);f.recorder.dispose();assert.equal(f.app.vault.load,native);
});
test('legacy labels are ignored and new preferences and records omit labels',()=>{const f=fixture();f.data.set(f.store.preferencesKey,JSON.stringify({enabled:true,mode:'measurement-only',label:'legacy'}));assert.deepEqual(f.store.preferences(),{enabled:true,mode:'measurement-only'});f.store.setPreferences(f.store.preferences());assert.ok(!f.data.get(f.store.preferencesKey)!.includes('label'));assert.ok(!('label' in f.recorder.run.condition));assert.deepEqual(f.store.history(),[]);});
test('a later cold start marks the previous uncompleted process record as interrupted',()=>{const f=fixture();f.store.save({...f.recorder.run,id:'previous'});f.store.save({...f.recorder.run,id:'new'});assert.equal(f.store.history()[0].status,'interrupted');assert.equal(f.store.history()[1].status,'in-progress');});
test('unfinished UI-ready checkpoints retain counts, plugin decisions and observation age',()=>{
 const f=fixture();f.app.plugins.enabledPlugins.add('missing');f.install();f.ready();f.show();
 f.setState({fastStart:{phase:'reconciling',scanned:123,background:{directories:3,nativeListMs:200,secret:'SECRET-PATH'},scheduler:{quietMs:100,secret:'SECRET'}},startup:{pending:['later'],plugins:[{id:'later',reason:'automatic',status:'待機中'},{id:'missing',reason:'unknown',status:'未読み込み'}]}});
 f.advance(1000);const saved=f.store.history()[0];assert.equal(saved.counts.files,1);assert.equal(saved.counts.tabs,2);assert.equal(saved.plugins.later.decision,'automatic');assert.equal(saved.plugins.missing.decision,'missing-manifest');assert.equal(saved.observation?.atMs,1100);
 assert.equal((saved.fastStart?.background as any).directories,3);assert.ok(!f.store.export().includes('SECRET'));f.recorder.dispose();
});
test('hidden and unload checkpoints refresh scan state instead of saving an earlier timer snapshot',()=>{
 const f=fixture();f.install();f.ready();f.show();f.advance(1000);f.setState({fastStart:{phase:'reconciling',scanned:900},startup:{pending:['later'],plugins:[]}});f.recorder.interaction(true);assert.equal(f.store.history()[0].fastStart?.scanned,900);assert.equal(f.store.history()[0].observation?.checkpoint,'hidden');
 f.setState({fastStart:{phase:'verified',verifiedAtMs:1200,scanned:1000}});f.recorder.dispose();const saved=f.store.history()[0];assert.equal(saved.fastStart?.phase,'verified');assert.equal(saved.milestones.verificationMs,1200);assert.equal(saved.observation?.interruption,'unload');
});
test('previous process interruption preserves its last observation instead of inventing a stop time',()=>{
 const f=fixture();f.store.save({...f.recorder.run,id:'old',observation:{atMs:4000,checkpoint:'periodic'}});f.store.save({...f.recorder.run,id:'new'});
 const saved=f.store.history()[0];assert.equal(saved.observation?.atMs,4000);assert.equal(saved.observation?.interruption,'previous-process-incomplete');
});
test('a hidden checkpoint immediately after UI readiness preserves counts before the first periodic tick',()=>{
 const f=fixture();f.install();f.ready();f.show();f.recorder.interaction(true);assert.equal(f.store.history()[0].counts.files,1);assert.equal(f.store.history()[0].counts.tabs,2);f.recorder.dispose();
});
test('UI-ready comparison conditions and counts survive later tab changes, hiding and interruption',()=>{
 const f=fixture();f.install();f.ready();f.show();assert.deepEqual(f.recorder.run.uiReadyState,{files:1,tabs:2,deferredTabs:1,hidden:false,interacted:false});
 f.app.workspace.iterateAllLeaves=(visit:any)=>visit({isDeferred:false});f.recorder.interaction();f.recorder.interaction(true);f.recorder.dispose();
 assert.equal(f.recorder.run.counts.tabs,1);assert.equal(f.recorder.run.uiReadyState?.tabs,2);assert.equal(f.recorder.run.uiReadyState?.hidden,false);assert.equal(f.recorder.run.uiReadyState?.interacted,false);assert.equal(f.recorder.run.status,'interrupted');
});
test('early input and hidden state are frozen into UI comparison conditions',()=>{
 const f=fixture();f.install();f.recorder.interaction();f.recorder.interaction(true);f.ready();f.show();assert.equal(f.recorder.run.uiReadyState?.interacted,true);assert.equal(f.recorder.run.uiReadyState?.hidden,true);f.recorder.dispose();
});
test('verification progress and cost exports never include paths or arbitrary diagnostic fields',()=>{
 const f=fixture();f.install();f.ready();f.show();f.setState({fastStart:{phase:'reconciling',pointStatMs:12,pointQueueWaitMs:4,startupPointStats:3,foregroundStatReuses:2,progress:{stage:'listing',path:'SECRET-NOTE',nativePending:true,waitingFor:'none'},background:{watchMs:90,indexMs:15,path:'SECRET-NOTE'}}});f.advance(1000);
 const saved=f.store.history()[0];assert.equal(saved.fastStart?.pointStatMs,12);assert.equal(saved.fastStart?.foregroundStatReuses,2);assert.equal((saved.fastStart?.progress as any).stage,'listing');assert.equal((saved.fastStart?.background as any).watchMs,90);assert.ok(!f.store.export().includes('SECRET-NOTE'));f.recorder.dispose();
});
test('diagnostic failure cannot escape a timer or unload, or falsely certify completion',()=>{
 const f=fixture();f.install();f.recorder.configure({},()=>{throw Error('unavailable');});f.ready();f.show();f.resolved();assert.doesNotThrow(()=>f.advance(3000));assert.equal(f.recorder.run.status,'in-progress');assert.ok(f.recorder.run.unavailable.includes('diagnostic-state'));assert.doesNotThrow(()=>f.recorder.dispose());
});

test('foreground action recording includes async preparation without changing the promise, receiver or arguments',async()=>{
 const f=fixture();f.install();let finish!:(value:string)=>void,receiver:any,args:any[]=[];
 const promise=new Promise<string>(r=>finish=r),prototype={openFile:function(this:any,...a:any[]){receiver=this;args=a;return promise;}};
 const leaf=Object.assign(Object.create(prototype),{app:f.app}),tabs={show:()=>7};
 f.recorder.observeActions(prototype,tabs);
 // Restoration before the loading overlay disappears is not a user action.
 assert.equal(tabs.show(),7);assert.equal(JSON.stringify(f.recorder.run.actions),undefined);
 f.ready();f.show();assert.equal(leaf.openFile('SECRET-NOTE'),promise);f.advance(250);finish('opened');assert.equal(await promise,'opened');
 assert.equal(receiver,leaf);assert.deepEqual(args,['SECRET-NOTE']);assert.deepEqual(f.recorder.run.actions?.noteOpen,[{startMs:100,durationMs:250,ok:true}]);
 assert.equal(tabs.show(),7);assert.equal(f.recorder.run.actions?.tabOverview.length,1);assert.ok(!f.store.export(f.recorder.run).includes('SECRET'));f.recorder.dispose();
});

test('action observer ignores other apps, records failures, caps history and preserves later wrappers',async()=>{
 const f=fixture();f.install();f.ready();f.show();let calls=0;const error=Error('original error');
 const original=function(this:any){calls++;if(this.fail)throw error;return 3;},prototype={openFile:original};
 const leaf=Object.assign(Object.create(prototype),{app:f.app}),other=Object.assign(Object.create(prototype),{app:{}});
 f.recorder.observeActions(prototype,undefined);other.openFile();assert.equal(JSON.stringify(f.recorder.run.actions),undefined);
 leaf.fail=true;assert.throws(()=>leaf.openFile(),e=>e===error);leaf.fail=false;
 for(let i=0;i<30;i++)assert.equal(leaf.openFile(),3);
 assert.equal(f.recorder.run.actions?.noteOpen.length,20);assert.equal(f.recorder.run.actions?.noteOpen[0].ok,false);
 const inside=prototype.openFile;prototype.openFile=function(){return inside.call(this);};f.recorder.dispose();
 const count=f.recorder.run.actions?.noteOpen.length;assert.equal(leaf.openFile(),3);assert.equal(f.recorder.run.actions?.noteOpen.length,count);assert.equal(calls,33);
});

test('recording cannot declare startup settled while an observed note is still waiting',async()=>{
 const f=fixture();f.install();f.ready();f.show();f.setState({});f.resolved();
 let reject!:(error:Error)=>void;const promise=new Promise<void>((_,r)=>reject=r),prototype={openFile:()=>promise};
 const leaf=Object.assign(Object.create(prototype),{app:f.app});f.recorder.observeActions(prototype,undefined);assert.equal(leaf.openFile(),promise);
 f.advance(3000);f.advance(3000);assert.equal(f.recorder.run.status,'in-progress');
 const error=Error('failed open');reject(error);await assert.rejects(promise,e=>e===error);await Promise.resolve();
 assert.equal(f.recorder.run.actions?.noteOpen[0].ok,false);f.advance(1000);f.advance(2000);assert.equal(f.recorder.run.status,'complete');assert.equal(prototype.openFile(),promise);
});

test('native plugin observation preserves order, promises, receiver and manager state',async()=>{
 const f=fixture(),calls:string[]=[],promises=new Map<string,Promise<string>>(),resolve=new Map<string,(value:string)=>void>();
 const manager=f.app.plugins,enabled=manager.enabledPlugins;
 const native=function(this:any,id:string){assert.equal(this,manager);calls.push(id);const p=new Promise<string>(r=>resolve.set(id,r));promises.set(id,p);return p;};
 manager.loadPlugin=native;
 const enable=()=>{throw Error('must not call enable');},save=()=>{throw Error('must not save order');};manager.enablePlugin=enable;manager.saveConfig=save;
 f.install();f.ready();f.show();f.resolved();f.setState({startup:{pluginLoading:'native'}});
 const first=manager.loadPlugin('later'),second=manager.loadPlugin('early');
 assert.equal(first,promises.get('later'));assert.equal(second,promises.get('early'));assert.deepEqual(calls,['later','early']);
 assert.equal(manager.enabledPlugins,enabled);assert.deepEqual([...enabled],['early','later']);assert.equal(manager.enablePlugin,enable);assert.equal(manager.saveConfig,save);
 f.advance(3000);f.advance(3000);assert.equal(f.recorder.run.status,'in-progress');assert.equal(f.recorder.run.milestones.pluginsSettledMs,null);
 resolve.get('early')!('early');await second;f.advance(2000);assert.equal(f.recorder.run.status,'in-progress');
 resolve.get('later')!('later');await first;f.advance(1000);f.advance(2000);assert.equal(f.recorder.run.status,'complete');
 assert.equal(manager.loadPlugin,native);assert.equal(f.recorder.run.plugins.later.decision,'native');assert.equal(f.recorder.run.startup?.pluginLoading,'native');
});

test('pending native load can reject after recorder unload without changing the rejection',async()=>{
 const f=fixture();let reject!:(error:Error)=>void;const promise=new Promise<void>((_,r)=>reject=r),native=()=>promise;
 f.app.plugins.loadPlugin=native;f.install();assert.equal(f.app.plugins.loadPlugin('later'),promise);f.recorder.dispose();
 const error=Error('native reject');reject(error);await assert.rejects(promise,e=>e===error);await Promise.resolve();
 assert.equal(f.app.plugins.loadPlugin,native);assert.deepEqual(f.recorder.run.plugins.later.loads,[]);
});


test('clearing a live record removes it from display and export and prevents later checkpoints from restoring it',()=>{
 const f=fixture();f.install();f.ready();f.show();f.advance(1000);
 assert.equal(f.store.runs(f.recorder.run).length,1);
 f.store.clear(f.recorder.run);
 assert.deepEqual(f.store.runs(f.recorder.run),[]);assert.deepEqual(JSON.parse(f.store.export(f.recorder.run)).runs,[]);
 f.advance(12000);f.recorder.dispose();assert.deepEqual(f.store.history(),[]);
 f.store.save({...f.recorder.run,id:'next-startup'});assert.equal(f.store.history().length,1);
});
test('clearing before the first checkpoint also suppresses the current run',()=>{
 const f=fixture();f.install();assert.equal(f.writes(),0);f.store.clear(f.recorder.run);
 f.ready();f.show();f.advance(12000);f.recorder.dispose();assert.deepEqual(f.store.history(),[]);
});
test('failed deletion leaves the current record visible and allows later saving',()=>{
 const data=new Map<string,string>(),store=new BenchmarkStore({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);},removeItem:()=>{throw Error('blocked');}},'LAB');
 const run=fixture().recorder.run;store.save(run);assert.throws(()=>store.clear(run),/blocked/);
 assert.equal(store.runs(run).length,1);store.save({...run,status:'complete'});assert.equal(store.history()[0].status,'complete');
});
