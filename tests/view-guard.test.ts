import {test} from 'node:test';import assert from 'node:assert/strict';
import {guardViewState,defersInitialView} from '../src/view-guard';import {IdleScheduler} from '../src/scheduler';
function fixture(){
 const scheduler=new IdleScheduler(()=>true),app={},leaf={app,working:false};let checks=0,calls=0,finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
 const native=Promise.resolve('native'),states:any[]=[];
 const original=function(this:any,state:any){assert.equal(this,leaf);calls++;states.push(state);return native;};
 const wrapped=guardViewState(original,{owns:l=>l.app===app,scanning:()=>true,ensure:async()=>{checks++;await gate;},scheduler});
 return {scheduler,leaf,native,states,wrapped,finish,checks:()=>checks,calls:()=>calls};
}
test('deferred rerenders cannot overtake the same leaf during file verification',async()=>{
 const f=fixture(),requested={type:'markdown',state:{file:'new.md'},active:true},old={type:'markdown',state:{file:'old.md'}};
 const task=f.wrapped.call(f.leaf,requested);await Promise.resolve();await f.wrapped.call(f.leaf,old);assert.equal(f.calls(),0);assert.equal(f.checks(),1);assert.equal(f.scheduler.hasForeground(),true);
 f.finish();assert.equal(await task,'native');assert.deepEqual(f.states,[requested]);assert.equal(f.scheduler.hasForeground(),false);
});
test('non-file views invoke the native guard immediately and retain promise identity',async()=>{const f=fixture();assert.equal(f.wrapped.call(f.leaf,{type:'graph',state:{}}),f.native);assert.equal(f.calls(),1);assert.equal(f.checks(),0);await f.native;assert.equal(f.scheduler.hasForeground(),false);});
test('all file views are verified before opening, even if already present in the inventory',async()=>{const f=fixture(),task=f.wrapped.call(f.leaf,{state:{file:'cached-image.png'}});await Promise.resolve();assert.equal(f.checks(),1);assert.equal(f.calls(),0);f.finish();await task;assert.equal(f.calls(),1);assert.equal(f.scheduler.hasForeground(),false);});
test('native working state bypasses preparation without another foreground hold',async()=>{const f=fixture();f.leaf.working=true;assert.equal(f.wrapped.call(f.leaf,{state:{file:'x.md'}}),f.native);assert.equal(f.checks(),0);assert.equal(f.scheduler.hasForeground(),false);});
test('other app leaves and inactive verification pass through untouched',()=>{const scheduler=new IdleScheduler(()=>true),native=Promise.resolve(),leaf={};let count=0;for(const [owns,scanning] of [[false,true],[true,false]]){const fn=guardViewState(()=>native,{owns:()=>owns,scanning:()=>scanning,ensure:async()=>{count++;},scheduler});assert.equal(fn.call(leaf,{state:{file:'x'}}),native);}assert.equal(count,0);assert.equal(scheduler.hasForeground(),false);});
test('verification and native errors release holds and permit later requests',async()=>{
 const scheduler=new IdleScheduler(()=>true),leaf={},error=Error('failure');let fail=true,calls=0;
 const fn=guardViewState(()=>{calls++;throw error;},{owns:()=>true,scanning:()=>true,ensure:async()=>{if(fail)throw error;},scheduler});
 await assert.rejects(fn.call(leaf,{state:{file:'x'}}),e=>e===error);assert.equal(calls,0);assert.equal(scheduler.hasForeground(),false);
 fail=false;await assert.rejects(fn.call(leaf,{state:{file:'y'}}),e=>e===error);assert.equal(calls,1);assert.equal(scheduler.hasForeground(),false);
});
test('native deferred startup leaves do not stat hidden files; their eventual rerender still verifies',async()=>{
 const scheduler=new IdleScheduler(()=>true),empty={},deferred={},app={workspace:{layoutReady:false},viewRegistry:{getViewCreatorByType:()=>()=>{}}};
 const leaf={app,_empty:empty,view:empty,working:false,containerEl:{isShown:()=>false}},state={type:'markdown',icon:'file',title:'Hidden',state:{file:'hidden.md'}};
 let checks=0,calls=0;const native=Promise.resolve();const wrapped=guardViewState(()=>{calls++;return native;},{owns:()=>true,scanning:()=>true,deferOnly:(l,s)=>defersInitialView(l,s,'1.14.4'),ensure:async()=>{checks++;},scheduler});
 assert.equal(wrapped.call(leaf,state),native);assert.equal(checks,0);assert.equal(scheduler.hasForeground(),false);
 leaf.view=deferred;await wrapped.call(leaf,state);assert.equal(checks,1);assert.equal(calls,2);assert.equal(scheduler.hasForeground(),false);
});
test('initial deferral requires the exact supported native branch, never an existing or visible view',()=>{
 const empty={},state={type:'image',icon:'image',title:'Image',state:{file:'image.png'}},leaf:any={_empty:empty,view:empty,app:{workspace:{layoutReady:false},viewRegistry:{getViewCreatorByType:()=>()=>{}}},containerEl:{isShown:()=>false}};
 assert.equal(defersInitialView(leaf,state,'1.14.4'),true);assert.equal(defersInitialView(leaf,state,'1.13.8'),true);assert.equal(defersInitialView(leaf,state,'1.14.5'),false);
 for(const changed of [{...leaf,view:{}},{...leaf,containerEl:{isShown:()=>true}},{...leaf,app:{...leaf.app,workspace:{layoutReady:true}}},{...leaf,_empty:undefined}])assert.equal(defersInitialView(changed,state,'1.14.4'),false);
 assert.equal(defersInitialView(leaf,{...state,title:undefined},'1.14.4'),false);assert.equal(defersInitialView(leaf,{...state,icon:''},'1.14.4'),false);
 leaf.app.viewRegistry.getViewCreatorByType=()=>undefined;assert.equal(defersInitialView(leaf,state,'1.14.4'),false);
});
test('a deferred-only request cannot overtake a same-leaf foreground preparation',async()=>{
 const scheduler=new IdleScheduler(()=>true),leaf={};let finish!:()=>void,calls=0;const gate=new Promise<void>(r=>finish=r);
 const fn=guardViewState(()=>{calls++;},{owns:()=>true,scanning:()=>true,deferOnly:(_l,state)=>state.deferred===true,ensure:()=>gate,scheduler});
 const task=fn.call(leaf,{state:{file:'active.md'}});await fn.call(leaf,{deferred:true,state:{file:'old.md'}});assert.equal(calls,0);finish();await task;assert.equal(calls,1);
});

test('an explicit note open during preparation waits and opens the requested note',async()=>{
 const f=fixture(),first={type:'markdown',state:{file:'old.md'}},requested={type:'markdown',state:{file:'new.md'},active:true};
 const previous=f.wrapped.call(f.leaf,first);await Promise.resolve();
 let completed=false;const next=f.wrapped.call(f.leaf,requested).then(()=>{completed=true;});
 await Promise.resolve();assert.equal(completed,false);assert.equal(f.calls(),0);
 f.finish();await Promise.all([previous,next]);assert.deepEqual(f.states,[first,requested]);assert.equal(f.checks(),2);assert.equal(f.scheduler.hasForeground(),false);
});

test('active opens wait through our native call and preserve rapid request order',async()=>{
 const scheduler=new IdleScheduler(()=>true),leaf={working:false},states:string[]=[];let finish!:()=>void;
 const gate=new Promise<void>(r=>finish=r);
 const fn=guardViewState(async(state:any)=>{states.push(state.state.file);leaf.working=true;if(states.length===1)await gate;leaf.working=false;},
  {owns:()=>true,scanning:()=>true,ensure:async()=>{},scheduler});
 const first=fn.call(leaf,{state:{file:'first.md'},active:true});
 while(!leaf.working)await Promise.resolve();
 const second=fn.call(leaf,{state:{file:'second.md'},active:true}),third=fn.call(leaf,{state:{file:'third.md'},active:true});
 await fn.call(leaf,{state:{file:'stale.md'}});assert.deepEqual(states,['first.md']);
 finish();await Promise.all([first,second,third]);assert.deepEqual(states,['first.md','second.md','third.md']);assert.equal(scheduler.hasForeground(),false);
});

test('a failed first verification does not discard a queued active open',async()=>{
 const scheduler=new IdleScheduler(()=>true),leaf={},states:string[]=[];let reject!:(error:Error)=>void;
 const gate=new Promise<void>((_resolve,r)=>reject=r),failure=Error('Missing previous file');
 const fn=guardViewState((state:any)=>{states.push(state.state.file);return Promise.resolve();},
  {owns:()=>true,scanning:()=>true,ensure:async path=>{if(path==='missing.md')await gate;},scheduler});
 const first=fn.call(leaf,{state:{file:'missing.md'}}),failed=assert.rejects(first,e=>e===failure);
 const next=fn.call(leaf,{state:{file:'present.md'},active:true});reject(failure);
 await Promise.all([failed,next]);assert.deepEqual(states,['present.md']);assert.equal(scheduler.hasForeground(),false);
});

test('an active note request also waits for our in-flight non-file view',async()=>{
 const scheduler=new IdleScheduler(()=>true),leaf={working:false},types:string[]=[];let finish!:()=>void;
 const gate=new Promise<void>(r=>finish=r);
 const fn=guardViewState(async(state:any)=>{types.push(state.type);leaf.working=true;if(state.type==='graph')await gate;leaf.working=false;},
  {owns:()=>true,scanning:()=>true,ensure:async()=>{},scheduler});
 const graph=fn.call(leaf,{type:'graph',active:true}),note=fn.call(leaf,{type:'markdown',state:{file:'note.md'},active:true});
 assert.deepEqual(types,['graph']);finish();await Promise.all([graph,note]);assert.deepEqual(types,['graph','markdown']);assert.equal(scheduler.hasForeground(),false);
});
