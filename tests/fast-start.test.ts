import {test} from 'node:test';import assert from 'node:assert/strict';
import {FastStart,Snapshot,Entry,validSnapshot} from '../src/fast-start';import {IdleScheduler} from '../src/scheduler';import {Scope,normalizeScope} from '../src/target';import {parseSettings} from '../src/policy';
const dir=(name:string):Entry=>({name,type:'directory'});const file=(name:string,mtime=1):Entry=>({name,type:'file',ctime:1,mtime,size:10});
const scope:Scope={all:false,folders:['Archive']};
// Obsidian supplies browser timers for the non-simulated scheduler test.
(globalThis as any).window=globalThis;
const base:Snapshot={version:2,root:'/vault',api:'1.13.8',scope,entries:[dir('Archive'),file('Archive/a.md')]};
function fixture(s:Snapshot=base,mode:'auto'|'always'='always',api='1.13.8'){
 const disk=new Map([dir('Archive'),file('Archive/a.md'),dir('Other'),file('Other/b.md'),file('active.md')].map(e=>[e.name,e]));
 let scans=0,writes=0,watch=0,now=10000;const timers:Function[]=[];let saved:Snapshot|undefined;
 const scheduler=new IdleScheduler(()=>true,()=>now,async ms=>{now+=ms;});
 const a:any={basePath:'/vault',files:{},getFullRealPath:(p:string)=>'/vault/'+p,getRealPath:(p:string)=>p,promise:Promise.resolve(),
 fs:{stat:async(p:string)=>{const v=disk.get(p.slice(7));if(!v)throw Object.assign(Error('missing'),{code:'ENOENT'});return v;},
 readdir:async(p:string)=>{const path=p.slice(7);return [...disk.values()].filter(e=>(e.name.includes('/')?e.name.slice(0,e.name.lastIndexOf('/')):'')===path).map(e=>({...e,name:e.name.split('/').pop()}));},watch:async()=>{watch++;},watchAndStatAll:async()=>{throw Error('Full scan must not run in background');}},
 quickList:(_:string,e:Entry)=>{a.files[e.name]={...e,realpath:e.name,type:e.type==='directory'?'folder':'file'};},removeFile:(p:string)=>{delete a.files[p];},onFileChange:()=>{},
 queue:(fn:()=>unknown)=>{a.promise=a.promise.then(fn,fn);return a.promise;},
 watchAndList:async()=>{scans++;a.files={'/':{type:'folder',realpath:'/'}};for(const e of disk.values())a.quickList('',e);},
 read:async()=> 'body',readBinary:async()=>new ArrayBuffer(0),stat:async()=>null,write:async()=>{writes++;},process:async()=>{writes++;},rename:async()=>{writes++;},remove:async()=>{writes++;},list:async()=>({})};
 const fast=new FastStart({api,adapter:a,scope:s.scope,mode,scheduler,load:()=>s,save:s=>{saved=s;},changed:()=>{},defer:fn=>timers.push(fn)});fast.install();
 return {a,fast,disk,scheduler,scans:()=>scans,writes:()=>writes,watch:()=>watch,saved:()=>saved,flush:async()=>{for(const fn of timers.splice(0))fn();await new Promise(r=>setImmediate(r));}};
}
test('live scan progress follows native directory I/O and clears after verification',async()=>{
 const f=fixture({...base,normalScanMs:3000});await f.a.watchAndList();assert.equal(f.fast.normalInventoryMs,3000);assert.ok(typeof f.fast.inventoryMs==='number');
 const native=f.a.fs.readdir;let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
 f.a.fs.readdir=async(path:string)=>{if(path==='/vault/Archive')await gate;return native(path);};const task=f.fast.verify();await new Promise(r=>setImmediate(r));
 assert.equal(f.fast.progress.nativePending,true);assert.equal(f.fast.progress.path,'Archive');assert.equal(f.fast.progress.stage,'listing');
 finish();await task;assert.equal(f.fast.progress.nativePending,false);assert.equal(f.fast.progress.stage,'done');assert.equal(f.fast.progress.path,'');assert.equal(f.fast.phase,'verified');
});
test('native watcher preparation is active work rather than an input wait',async()=>{
 const f=fixture();await f.a.watchAndList();let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);f.a.fs.watch=()=>gate;
 const task=f.fast.verify();await new Promise(r=>setImmediate(r));assert.equal(f.fast.progress.stage,'watching');assert.equal(f.fast.progress.nativePending,true);
 finish();await task;assert.equal(f.fast.progress.nativePending,false);assert.equal(f.fast.phase,'verified');
});
test('multiple targets and whole Vault snapshots validate without hidden names',()=>{
 const multi={...base,scope:{all:false,folders:['Archive','Other']},entries:[...base.entries,dir('Other'),file('Other/b.md')]};assert.ok(validSnapshot(multi,'/vault',multi.scope,'1.13.8'));
 const all={...multi,scope:{all:true,folders:[]},entries:[...multi.entries,file('root.md')]};assert.ok(validSnapshot(all,'/vault',all.scope,'1.13.8'));
 assert.equal(validSnapshot({...all,entries:[...all.entries,file('../escape.md')]},'/vault',all.scope,'1.13.8'),false);
 assert.deepEqual(normalizeScope({all:false,folders:['Archive/Sub','Other','Archive','Archive']}),{all:false,folders:['Archive','Other']});
});
test('old target migrates, obsolete safety settings are not retained',()=>{assert.deepEqual(parseSettings({version:1,targetFolder:'資料',enabled:true}),{version:2,scope:{all:false,folders:['資料']},startup:{workspace:true}});});
test('old plugin delay and ordering settings are ignored while workspace preferences remain',()=>{
  assert.deepEqual(parseSettings({version:2,scope:{all:true,folders:[]},startup:{plugins:'selected',selected:['x'],immediate:['y'],first:true,workspace:false,fastTabs:false}}),{version:2,scope:{all:true,folders:[]},startup:{workspace:false,fastTabs:false}});
  assert.equal(parseSettings(null).startup.fastTabs,undefined);
});
test('foreground target reading never starts or waits for the complete scan',async()=>{
 const f=fixture();await f.a.watchAndList();f.scheduler.prioritize('Archive/a.md');await f.a.read('Archive/a.md');assert.equal(f.fast.phase,'provisional');assert.equal(f.watch(),0);assert.equal(f.scans(),0);
});

test('incremental scan reflects externally created modified and removed files',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.delete('Archive/a.md');f.disk.set('Archive/new.md',file('Archive/new.md',7));await f.fast.verify();assert.equal(f.fast.phase,'verified');assert.equal(f.a.files['Archive/a.md'],undefined);assert.equal(f.a.files['Archive/new.md'].mtime,7);assert.equal(f.writes(),0);assert.equal(f.watch(),1);
});
test('whole Vault seeds all cached subfolders while discovering live root notes',async()=>{
 const s={...base,scope:{all:true,folders:[]},entries:[...base.entries,dir('Other'),file('Other/b.md')]};const f=fixture(s);await f.a.watchAndList();assert.ok(f.a.files['Other/b.md']);assert.ok(f.a.files['active.md']);await f.fast.verify();assert.equal(f.fast.phase,'verified');
});
test('multiple folders cache together and normal outside entries remain live',async()=>{
 const s={...base,scope:{all:false,folders:['Archive','Other']},entries:[...base.entries,dir('Other'),file('Other/b.md')]};const f=fixture(s);await f.a.watchAndList();assert.equal(f.scans(),0);await f.fast.verify();await f.flush();assert.equal(f.saved()?.scope.folders.length,2);
});
test('a stale write cannot overwrite an external edit, fresh reads can then be edited',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/a.md',file('Archive/a.md',5));await assert.rejects(f.a.write('Archive/a.md','stale'));assert.equal(f.writes(),0);await f.a.read('Archive/a.md');await f.a.write('Archive/a.md','fresh');assert.equal(f.writes(),1);
});
test('empty new files and Templater process writes do not require a global scan',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.write('Archive/new.md','');await f.a.process('Archive/a.md',()=> 'template');assert.equal(f.watch(),0);assert.equal(f.writes(),2);
});
test('stale absence cannot be used to overwrite an externally created destination',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/new.md',file('Archive/new.md'));await assert.rejects(f.a.write('Archive/new.md',''));assert.equal(f.writes(),0);
});
test('configuration and diagnostic writes remain outside the content guard',async()=>{const f=fixture();await f.a.watchAndList();await f.a.write('.obsidian/plugin/data.json','{}');assert.equal(f.writes(),1);});
test('stat permission failure blocks a mutation without pretending it is deletion',async()=>{const f=fixture();await f.a.watchAndList();f.a.fs.stat=async()=>{throw Error('denied');};await assert.rejects(f.a.write('Archive/a.md','x'));assert.equal(f.writes(),0);assert.ok(f.a.files['Archive/a.md']);});
test('unsupported versions leave the adapter untouched',()=>{const f=fixture();f.fast.dispose();const original=f.a.watchAndList;const fast=new FastStart({api:'1.14.0',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});assert.equal(fast.install(),false);assert.equal(f.a.watchAndList,original);});
test('1.14.4 retains the validated 1.13.8 inventory on the first updated boot',async()=>{
 const f=fixture(base,'always','1.14.4');await f.a.watchAndList();assert.equal(f.scans(),0);assert.equal(f.fast.phase,'provisional');await f.fast.verify();await f.flush();assert.equal(f.saved()?.api,'1.14.4');
});
test('an unvalidated inventory version cannot be reused by a supported adapter',async()=>{
 const f=fixture({...base,api:'1.14.0'},'always','1.14.4');await f.a.watchAndList();assert.equal(f.scans(),1);assert.equal(f.fast.phase,'normal');
});
test('auto mode measures native scanning again after an app update instead of reusing an obsolete speed estimate',async()=>{
 const s={...base,normalScanMs:9000,entries:[dir('Archive'),...Array.from({length:1000},(_,i)=>file('Archive/'+i+'.md'))]};
 const f=fixture(s,'auto','1.14.4');await f.a.watchAndList();assert.equal(f.scans(),1);assert.equal(f.fast.phase,'normal');await f.flush();assert.equal(f.saved()?.api,'1.14.4');assert.ok(f.saved()!.normalScanMs!<2500);
});
test('view dependencies and binary reads cannot deadlock behind the foreground hold',async()=>{
 const f=fixture();await f.a.watchAndList();const release=f.scheduler.beginForeground('active.md');
 f.scheduler.idle=async()=>{throw Error('Foreground dependencies must not wait for idle');};
 try{assert.equal(await f.a.read('Archive/a.md'),'body');await f.a.readBinary('Other/b.md');assert.equal(f.watch(),0);}finally{release();}
});
test('a missing native capability falls back before patching any adapter method',()=>{
 const f=fixture();f.fast.dispose();delete f.a.fs.watch;const original=f.a.watchAndList;
 const fast=new FastStart({api:'1.14.4',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});
 assert.equal(fast.install(),false);assert.equal(f.a.watchAndList,original);assert.equal(fast.reasonKey,'missingApi');
});

test('a locked mutation guard rolls back all inventory hooks before a snapshot can be seeded',async()=>{
 const f=fixture();await f.fast.dispose();Object.defineProperty(f.a,'write',{writable:false});const before=Object.getOwnPropertyDescriptors(f.a);
 const fast=new FastStart({api:'1.14.4',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});
 let installed:boolean|undefined;assert.doesNotThrow(()=>{installed=fast.install();});assert.equal(installed,false);assert.equal(fast.phase,'unsupported');
 assert.deepEqual(Object.getOwnPropertyDescriptors(f.a),before);await f.a.watchAndList();assert.equal(f.scans(),1);assert.equal(fast.seeded,0);
});

test('inventory hook cleanup restores inherited read methods and native descriptors',async()=>{
 const f=fixture();await f.fast.dispose();const native=f.a.read;delete f.a.read;Object.setPrototypeOf(f.a,{read:native});
 Object.defineProperty(f.a,'write',{...Object.getOwnPropertyDescriptor(f.a,'write'),enumerable:false});const before=Object.getOwnPropertyDescriptors(f.a);
 const fast=new FastStart({api:'1.14.4',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});
 assert.equal(fast.install(),true);await fast.dispose();assert.deepEqual(Object.getOwnPropertyDescriptors(f.a),before);assert.equal(f.a.read,native);
});
test('unload completes verification before removing guards',async()=>{const f=fixture();await f.a.watchAndList();f.fast.dispose();await f.fast.verify();assert.equal(f.fast.phase,'verified');});

test('a foreground read during enumeration does not hide new siblings',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/new.md',file('Archive/new.md',8));
 const original=f.a.fs.readdir;let once=false;
 f.a.fs.readdir=async(p:string)=>{const entries=await original(p);if(p==='/vault/Archive'&&!once){once=true;f.scheduler.prioritize('Archive/a.md');await f.a.read('Archive/a.md');}return entries;};
 await f.fast.verify();assert.equal(f.a.files['Archive/new.md'].mtime,8);assert.equal(f.fast.phase,'verified');
});

test('a foreground refresh during directory enumeration cannot be reverted by stale stats',async()=>{
 const f=fixture();await f.a.watchAndList();const original=f.a.fs.readdir;let once=false;
 f.a.fs.readdir=async(p:string)=>{const entries=await original(p);if(p==='/vault/Archive'&&!once){once=true;f.disk.set('Archive/a.md',file('Archive/a.md',9));await f.fast.ensurePath('Archive/a.md');}return entries;};
 await f.fast.verify();await f.flush();assert.equal(f.a.files['Archive/a.md'].mtime,9);assert.equal(f.saved()?.entries.find(e=>e.name==='Archive/a.md')?.mtime,9);
});

test('automatic mode retains ordinary scanning for a fast previous inventory',async()=>{const f=fixture({...base,normalScanMs:300},'auto');await f.a.watchAndList();assert.equal(f.scans(),1);assert.equal(f.fast.phase,'normal');});
test('automatic mode uses a slow sufficiently large inventory',async()=>{const s={...base,normalScanMs:3000,entries:[dir('Archive'),...Array.from({length:1000},(_,i)=>file('Archive/'+i+'.md'))]};const f=fixture(s,'auto');await f.a.watchAndList();assert.equal(f.scans(),0);assert.equal(f.fast.phase,'provisional');});
test('invalid cached inventory falls back without seeding stale paths',async()=>{const f=fixture({...base,entries:[...base.entries,file('Archive/../escape.md')]});await f.a.watchAndList();assert.equal(f.scans(),1);assert.equal(f.a.files['Archive/../escape.md'],undefined);});

test('background reads reuse confirmed parents and files but writes still stat the file',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.read('Archive/a.md');const before=f.fast.pointStats;
 for(let i=0;i<20;i++)await f.a.read('Archive/a.md');assert.equal(f.fast.pointStats,before);
 f.disk.set('Archive/a.md',file('Archive/a.md',8));await assert.rejects(f.a.write('Archive/a.md','stale'));assert.equal(f.writes(),0);assert.equal(f.fast.pointStats,before+1);
});
test('watch notifications invalidate a previously confirmed background read',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.read('Archive/a.md');f.disk.set('Archive/a.md',file('Archive/a.md',7));f.a.onFileChange('Archive/a.md');await f.a.read('Archive/a.md');assert.equal(f.a.files['Archive/a.md'].mtime,7);
});
test('normal startup does not serialize or save the snapshot on its critical path',async()=>{const f=fixture({...base,normalScanMs:100},'auto');await f.a.watchAndList();assert.equal(f.saved(),undefined);await f.flush();assert.ok(f.saved());});

test('many folders do not cause repeated full inventory enumeration',async()=>{
 const f=fixture();for(let i=0;i<100;i++)f.disk.set('Archive/folder'+i,dir('Archive/folder'+i));await f.a.watchAndList();let enumerations=0;
 f.a.files=new Proxy(f.a.files,{ownKeys(target){enumerations++;return Reflect.ownKeys(target);}});
 await f.fast.verify();assert.equal(f.fast.phase,'verified');assert.equal(enumerations,1);
});

test('a scan cannot trigger creation templates for existing discovered files',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/existing.md',file('Archive/existing.md'));const original=f.a.quickList;let recognized=false;
 f.a.quickList=(root:string,e:Entry)=>{if(e.name==='Archive/existing.md')recognized=f.fast.recognizing===e.name;original(root,e);};
 await f.fast.verify();assert.equal(recognized,true);assert.equal(f.fast.recognizing,null);
});

test('a foreground verification passes queued background checks',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.read('Archive/a.md');
 for(const path of ['Archive/one.md','Archive/two.md','Archive/three.md'])f.disk.set(path,file(path));
 const stat=f.a.fs.stat,order:string[]=[];let unblock=()=>{};
 const blocked=new Promise<void>(r=>{unblock=r;});
 f.a.fs.stat=async(p:string)=>{order.push(p);if(p==='/vault/Archive/one.md')await blocked;return stat(p);};
 const reads=['Archive/one.md','Archive/two.md','Archive/three.md'].map(p=>f.a.read(p));
 await new Promise(r=>setImmediate(r));f.scheduler.prioritize('active.md');const foreground=f.a.read('active.md');unblock();
 await Promise.all([...reads,foreground]);assert.deepEqual(order.slice(0,2),['/vault/Archive/one.md','/vault/active.md']);
});

test('a queued read reused by a write still performs a fresh stat after inventory confirmation',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.read('Archive/a.md');f.disk.set('Archive/block.md',file('Archive/block.md'));
 const stat=f.a.fs.stat;let unblock=()=>{};const blocked=new Promise<void>(r=>{unblock=r;});
 f.a.fs.stat=async(p:string)=>{if(p==='/vault/Archive/block.md')await blocked;return stat(p);};
 const blocking=f.a.read('Archive/block.md');await new Promise(r=>setImmediate(r));
 f.a.onFileChange('Archive/a.md');const reading=f.a.read('Archive/a.md');await new Promise(r=>setImmediate(r));
 const writing=f.a.write('Archive/a.md','stale');const rejected=assert.rejects(writing);
 const scan=f.fast.verify();await new Promise(r=>setImmediate(r));f.disk.set('Archive/a.md',file('Archive/a.md',9));unblock();
 await Promise.all([scan,blocking,reading,rejected]);assert.equal(f.writes(),0);assert.equal(f.a.files['Archive/a.md'].mtime,9);
});


test('unchanged inventories finish without re-recognizing files and report native directory work separately',async()=>{
 const f=fixture();await f.a.watchAndList();let recognized=0;const original=f.a.quickList;f.a.quickList=(...args:any[])=>{recognized++;return original(...args);};
 await f.fast.verify();assert.equal(recognized,0);assert.equal(f.fast.background.updated,0);assert.equal(f.fast.background.unchanged,f.disk.size);assert.equal(f.fast.background.directories,3);assert.ok(f.fast.background.startedAtMs!==null);assert.equal(f.writes(),0);
});

test('a large directory pauses after input arrives during native enumeration, then still reconciles every entry',async()=>{
 const f=fixture();for(let i=0;i<1000;i++)f.disk.set('Archive/f'+i+'.md',file('Archive/f'+i+'.md'));await f.a.watchAndList();
 const readdir=f.a.fs.readdir;let triggered=false,paused=false;
 f.a.fs.readdir=async(path:string)=>{const rows=await readdir(path);if(path==='/vault/Archive'){triggered=true;f.scheduler.activity(160);}return rows;};
 const idle=f.scheduler.idle.bind(f.scheduler);f.scheduler.idle=async()=>{if(triggered&&f.fast.scanned<1000)paused=true;await idle();};
 await f.fast.verify();assert.equal(paused,true);assert.equal(f.fast.phase,'verified');assert.equal(f.fast.scanned,f.disk.size);assert.ok(f.scheduler.timing.quietMs>=160);assert.equal(f.writes(),0);
});


test('unchanged inventory confirmation does not wait behind unrelated adapter content I/O',async()=>{
 const f=fixture();await f.a.watchAndList();f.a.queue=()=>{throw Error('Unchanged inventory must not join adapter queue');};
 await f.fast.verify();assert.equal(f.fast.phase,'verified');assert.equal(f.fast.background.queueWaitMs,0);assert.equal(f.fast.background.unchanged,f.disk.size);
});

test('real inventory updates still serialize with adapter I/O and recheck the revision fence',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/a.md',file('Archive/a.md',8));const queue=f.a.queue;let queued=0;
 f.a.queue=(fn:()=>unknown)=>{queued++;return queue(fn);};await f.fast.verify();assert.ok(queued>0);assert.equal(f.a.files['Archive/a.md'].mtime,8);assert.equal(f.fast.background.updated,1);assert.equal(f.writes(),0);
});

test('a folder request verifies locally instead of awaiting its own foreground hold',async()=>{
 const f=fixture();await f.a.watchAndList();const release=f.scheduler.beginForeground('Archive/a.md');const idle=f.scheduler.idle.bind(f.scheduler);
 f.scheduler.idle=async()=>{while(f.scheduler.hasForeground())await new Promise(r=>setTimeout(r,1));await idle();};
 let timer:any;
 try{await Promise.race([f.a.remove('Archive'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Folder operation deadlocked')),100);})]);assert.equal(f.writes(),1);}
 finally{clearTimeout(timer);release();await f.fast.verify();f.fast.dispose();}
});

test('an adapter has only one inventory owner while unloading and after a failed scan',async()=>{
 const f=fixture();await f.a.watchAndList();let finish=()=>{};
 const blocked=new Promise<void>(resolve=>{finish=resolve;});const readdir=f.a.fs.readdir;f.a.fs.readdir=async(p:string)=>{await blocked;return readdir(p);};
 f.fast.dispose();const original=f.a.watchAndList;
 const next=new FastStart({api:'1.13.8',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});
 assert.equal(next.install(),false);assert.equal(f.a.watchAndList,original);next.dispose();finish();await f.fast.verify();await new Promise(r=>setImmediate(r));
 assert.equal(next.install(),false,'a disposed instance cannot be installed again');
 const failed=fixture();await failed.a.watchAndList();failed.a.fs.readdir=async()=>{throw Error('denied');};await assert.rejects(failed.fast.verify());failed.fast.dispose();
 const replacement=new FastStart({api:'1.13.8',adapter:failed.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});
 assert.equal(replacement.install(),false);await assert.rejects(failed.a.write('Archive/a.md','x'));assert.equal(failed.writes(),0);assert.equal(failed.fast.phase,'failed');
});

test('changes arriving during the final idle wait are reconciled before declaring completion',async()=>{
 const f=fixture();await f.a.watchAndList();const idle=f.scheduler.idle.bind(f.scheduler);let changed=false;
 f.scheduler.idle=async()=>{await idle();if(!changed&&f.fast.scanned>=f.disk.size){changed=true;f.disk.set('Archive/a.md',file('Archive/a.md',42));f.a.onFileChange('Archive/a.md');}};
 await f.fast.verify();assert.equal(changed,true);assert.equal(f.a.files['Archive/a.md'].mtime,42);assert.equal(f.fast.phase,'verified');assert.equal(f.writes(),0);
});

test('a seed failure remains failed and cannot be converted into an automatic repair scan',async()=>{
 const f=fixture();f.a.quickList=()=>{throw Error('Incompatible host');};await assert.rejects(f.a.watchAndList());assert.equal(f.fast.phase,'failed');
 await assert.rejects(f.fast.verify());assert.equal(f.watch(),0);f.fast.dispose();await new Promise(r=>setImmediate(r));assert.equal(f.watch(),0);assert.equal(f.fast.phase,'failed');
});

test('successful unload releases ownership without replacing later wrappers or losing discovery protection',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/discovered.md',file('Archive/discovered.md'));const wrapped=f.a.read;
 f.a.read=(...args:any[])=>wrapped(...args);const later=f.a.read;let protectedUntilDone=true,recognizedProtected=false;
 const quick=f.a.quickList;f.a.quickList=(root:string,e:Entry)=>{if(e.name==='Archive/discovered.md')recognizedProtected=protectedUntilDone;quick(root,e);};
 await f.fast.dispose().then(()=>{protectedUntilDone=false;});assert.equal(recognizedProtected,true);assert.equal(f.a.read,later);assert.equal(await f.a.read('Archive/a.md'),'body');
 const next=new FastStart({api:'1.13.8',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});assert.equal(next.install(),true);await next.dispose();
});

test('a delegated write in flight keeps verification provisional until its completion notification is checked',async()=>{
 const f=fixture();let finish=()=>{};const blocked=new Promise<void>(r=>{finish=r;});
 // Replace the native method before installing this instance's guards.
 await f.fast.dispose();f.a.write=async()=>{await blocked;f.disk.set('Archive/a.md',file('Archive/a.md',18));};
 const fast=new FastStart({api:'1.13.8',adapter:f.a,scope,scheduler:new IdleScheduler(),load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});fast.install();await f.a.watchAndList();
 const writing=f.a.write('Archive/a.md','fresh');await new Promise(r=>setImmediate(r));const scanning=fast.verify();await new Promise(r=>setTimeout(r,50));assert.equal(fast.phase,'reconciling');
 finish();await Promise.all([writing,scanning]);assert.equal(fast.phase,'verified');assert.equal(f.a.files['Archive/a.md'].mtime,18);await fast.dispose();
});

test('a pending point check cannot recognize files after inventory failure and disposal',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('Archive/late.md',file('Archive/late.md'));const stat=f.a.fs.stat;let finish=()=>{},recognized=0;
 const blocked=new Promise<void>(r=>{finish=r;});f.a.fs.stat=async(p:string)=>{if(p.endsWith('/late.md'))await blocked;return stat(p);};
 const quick=f.a.quickList;f.a.quickList=(root:string,e:Entry)=>{if(e.name==='Archive/late.md')recognized++;quick(root,e);};
 const reading=f.fast.ensurePath('Archive/late.md');const rejection=assert.rejects(reading);await new Promise(r=>setImmediate(r));
 f.a.fs.readdir=async()=>{throw Error('denied');};await assert.rejects(f.fast.verify());await f.fast.dispose();finish();await rejection;
 assert.equal(recognized,0);assert.equal(f.a.files['Archive/late.md'],undefined);assert.equal(f.writes(),0);
});

test('unload during the initial native root read falls back without leaving an unguarded seeded inventory',async()=>{
 const f=fixture();let finish=()=>{};const blocked=new Promise<void>(r=>{finish=r;}),readdir=f.a.fs.readdir;
 f.a.fs.readdir=async(p:string)=>{await blocked;return readdir(p);};const starting=f.a.watchAndList();const unloading=f.fast.dispose();
 const next=new FastStart({api:'1.13.8',adapter:f.a,scope,load:()=>base,save:()=>{},changed:()=>{},defer:()=>{}});assert.equal(next.install(),false);
 finish();await Promise.all([starting,unloading]);assert.equal(f.fast.phase,'normal');assert.equal(f.scans(),1);assert.equal(f.fast.seeded,0);assert.ok(f.a.files['Archive/a.md']);
});

test('failed inventory protection leaves configuration accessible for recovery',async()=>{
 const f=fixture();await f.a.watchAndList();f.a.fs.readdir=async()=>{throw Error('denied');};await assert.rejects(f.fast.verify());await f.fast.dispose();
 assert.equal(await f.a.read('.obsidian/community-plugins.json'),'body');await f.a.write('.obsidian/plugins/boot-booster/data.json','{}');
 await assert.rejects(f.a.write('Archive/a.md','stale'));assert.equal(f.writes(),1);
});

test('ambiguous paths, root mutations and mixed hidden destinations cannot bypass pending guards',async()=>{
 const f=fixture();await f.a.watchAndList();
 for(const path of ['Archive//a.md','Archive/a.md/','__proto__','/',''])await assert.rejects(f.a.write(path,'stale'));
 await assert.rejects(f.a.rename('Archive/a.md','.hidden/a.md'));assert.equal(f.writes(),0);await f.fast.dispose();
});

test('a foreground open reuses its preflight for body reads, but the next open checks again',async()=>{
 const f=fixture();await f.a.watchAndList();
 let release=f.scheduler.beginForeground('Archive/a.md');await f.fast.ensurePath('Archive/a.md');const before=f.fast.pointStats;
 await f.a.read('Archive/a.md');await f.a.readBinary('Archive/a.md');assert.equal(f.fast.pointStats,before);assert.equal(f.fast.foregroundStatReuses,2);release();
 release=f.scheduler.beginForeground('Archive/a.md');await f.a.read('Archive/a.md');assert.equal(f.fast.pointStats,before+1);release();
});
test('watcher changes and adapter signature changes invalidate foreground preflight reuse',async()=>{
 const f=fixture();await f.a.watchAndList();const release=f.scheduler.beginForeground('Archive/a.md');await f.fast.ensurePath('Archive/a.md');let before=f.fast.pointStats;
 f.disk.set('Archive/a.md',file('Archive/a.md',8));f.a.onFileChange('Archive/a.md');await f.a.read('Archive/a.md');assert.equal(f.fast.pointStats,before+1);assert.equal(f.a.files['Archive/a.md'].mtime,8);
 before=f.fast.pointStats;f.a.files['Archive/a.md'].size=99;await f.a.read('Archive/a.md');assert.equal(f.fast.pointStats,before+1);release();
});
test('foreground mutations never reuse a preflight and still reject stale writes',async()=>{
 const f=fixture();await f.a.watchAndList();const release=f.scheduler.beginForeground('Archive/a.md');await f.fast.ensurePath('Archive/a.md');let before=f.fast.pointStats;
 await f.a.write('Archive/a.md','body');assert.equal(f.fast.pointStats,before+1);assert.equal(f.writes(),1);
 before=f.fast.pointStats;f.disk.set('Archive/a.md',file('Archive/a.md',9));await assert.rejects(f.a.write('Archive/a.md','stale'));assert.equal(f.fast.pointStats,before+1);assert.equal(f.writes(),1);release();
});

test('a watcher event arriving during a preflight prevents reusing that stat result',async()=>{
 const f=fixture();await f.a.watchAndList();const release=f.scheduler.beginForeground('Archive/a.md'),stat=f.a.fs.stat;
 let changed=false;f.a.fs.stat=async(path:string)=>{const entry=await stat(path);if(path.endsWith('/a.md')&&!changed){changed=true;f.disk.set('Archive/a.md',file('Archive/a.md',12));f.a.onFileChange('Archive/a.md');}return entry;};
 await f.fast.ensurePath('Archive/a.md');const before=f.fast.pointStats;
 await f.a.read('Archive/a.md');assert.equal(f.fast.pointStats,before+1);assert.equal(f.a.files['Archive/a.md'].mtime,12);assert.equal(f.fast.foregroundStatReuses,0);release();
});

test('a watcher event during the mutation stat cannot authorize an overwrite with its old result',async()=>{
 const f=fixture();await f.a.watchAndList();const stat=f.a.fs.stat;let changed=false;
 f.a.fs.stat=async(path:string)=>{const entry=await stat(path);if(path.endsWith('/a.md')&&!changed){changed=true;f.disk.set('Archive/a.md',file('Archive/a.md',12));f.a.onFileChange('Archive/a.md');}return entry;};
 await assert.rejects(f.a.write('Archive/a.md','stale'),/外部/);assert.equal(f.writes(),0);
 await f.a.read('Archive/a.md');await f.a.write('Archive/a.md','fresh');assert.equal(f.writes(),1);await f.fast.dispose();
});

test('a source change while checking the rename destination prevents delegation',async()=>{
 const f=fixture();await f.a.watchAndList();const stat=f.a.fs.stat;
 f.a.fs.stat=async(path:string)=>{if(path.endsWith('/new.md')){f.disk.set('Archive/a.md',file('Archive/a.md',19));f.a.onFileChange('Archive/a.md');}return stat(path);};
 await assert.rejects(f.a.rename('Archive/a.md','Archive/new.md'),/外部/);assert.equal(f.writes(),0);await f.fast.dispose();
});
