import {test} from 'node:test';import assert from 'node:assert/strict';
import {FastStart,Entry,Snapshot} from '../src/fast-start';import {IdleScheduler} from '../src/scheduler';
const directory=(name:string):Entry=>({name,type:'directory'});
const note=(name:string,mtime=1):Entry=>({name,type:'file',ctime:1,mtime,size:10});
const inside=(path:string,root:string)=>path===root||path.startsWith(root+'/');
function fixture(){
 const entries=[directory('資料'),directory('資料/子'),note('資料/子/note.md')],disk=new Map(entries.map(e=>[e.name,e]));
 const snapshot:Snapshot={version:2,api:'1.14.4',root:'/lab',scope:{all:true,folders:[]},entries};
 let mutations=0,fullScans=0,clock=10000;const lists:string[]=[];
 const scheduler=new IdleScheduler(()=>true,()=>clock,async ms=>{clock+=ms;});
 const a:any={basePath:'/lab',files:{},promise:Promise.resolve(),getFullRealPath:(p:string)=>'/lab/'+p,getRealPath:(p:string)=>p,
  fs:{watch:async()=>{},stat:async(full:string)=>{const entry=disk.get(full.slice(5));if(!entry)throw Object.assign(Error('missing'),{code:'ENOENT'});return {...entry};},
   readdir:async(full:string)=>{const parent=full.slice(5);lists.push(parent);if(parent&&!disk.has(parent))throw Object.assign(Error('missing'),{code:'ENOENT'});return [...disk.values()].filter(e=>e.name.slice(0,Math.max(0,e.name.lastIndexOf('/')))===parent).map(e=>({...e,name:e.name.slice(e.name.lastIndexOf('/')+1)}));}},
  queue:(fn:()=>unknown)=>{a.promise=a.promise.then(fn,fn);return a.promise;},
  quickList:(_:string,e:Entry)=>{a.files[e.name]={...e,type:e.type==='directory'?'folder':'file',realpath:e.name};},
  removeFile:(p:string)=>{delete a.files[p];},onFileChange:()=>{},
  watchAndList:async()=>{fullScans++;for(const entry of disk.values())a.quickList('',entry);},
  mkdir:(path:string)=>a.queue(()=>{mutations++;const entry=directory(path);disk.set(path,entry);a.quickList('',entry);}),
  rename:(source:string,target:string)=>{if(source===target)return Promise.resolve();return a.queue(()=>{mutations++;for(const [path,entry] of [...disk])if(inside(path,source)){const name=target+path.slice(source.length);disk.delete(path);delete a.files[path];disk.set(name,{...entry,name});a.quickList('',{...entry,name});}});},
  read:(_path:string)=>a.queue(()=> 'body'),
  write:(path:string)=>a.queue(async()=>{a.writeStarted=true;await a.writeGate;mutations++;const entry=note(path,2);disk.set(path,entry);a.quickList('',entry);})};
 for(const name of ['remove','rmdir','trashLocal','trashSystem'])a[name]=(path:string,..._args:unknown[])=>a.queue(()=>{mutations++;for(const key of [...disk.keys()])if(inside(key,path)){disk.delete(key);delete a.files[key];}return name==='trashSystem'?true:undefined;});
 const fast=new FastStart({api:'1.14.4',adapter:a,scope:snapshot.scope,mode:'always',scheduler,load:()=>snapshot,save:()=>{},changed:()=>{},defer:()=>{}});assert.ok(fast.install());
 return {a,fast,disk,scheduler,lists,mutations:()=>mutations,fullScans:()=>fullScans};
}

test('a newly created folder can be renamed and removed before global verification finishes',async()=>{
 const f=fixture();await f.a.watchAndList();f.scheduler.idle=async()=>{throw Error('User folder operations must not wait for global idle');};
 await f.a.mkdir('新しいフォルダ');await f.a.rename('新しいフォルダ','変更後');await f.a.rmdir('変更後',false);
 assert.equal(f.mutations(),3);assert.equal(f.disk.has('新しいフォルダ'),false);assert.equal(f.disk.has('変更後'),false);assert.equal(f.a.files['変更後'],undefined);assert.equal(f.fast.phase,'provisional');assert.equal(f.fullScans(),0);
});

test('a populated folder rename checks only that subtree and keeps native descendant paths',async()=>{
 const f=fixture();await f.a.watchAndList();f.lists.length=0;await f.a.rename('資料','移動後');
 assert.ok(f.disk.has('移動後/子/note.md'));assert.equal(f.disk.has('資料/子/note.md'),false);assert.equal(f.a.files['資料'],undefined);assert.equal(f.a.files['移動後/子/note.md'].realpath,'移動後/子/note.md');
 assert.deepEqual(f.lists,['資料','資料/子']);assert.equal(f.fullScans(),0);await f.fast.verify();assert.equal(f.fast.phase,'verified');assert.equal(f.a.files['資料'],undefined);await f.fast.dispose();
});

test('folder removal delegates native remove, rmdir and trash without waiting for global verification',async()=>{
 for(const name of ['remove','rmdir','trashLocal','trashSystem']){const f=fixture();await f.a.watchAndList();const result=await f.a[name]('資料',true);
  assert.equal(result,name==='trashSystem'?true:undefined);assert.equal(f.disk.size,0);assert.equal(f.mutations(),1);await f.fast.verify();assert.equal(f.a.files['資料'],undefined);await f.fast.dispose();}
});

test('newly discovered children are shown before a folder deletion is approved on retry',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('資料/外部.md',note('資料/外部.md'));
 await assert.rejects(f.a.remove('資料'),/外部/);assert.equal(f.mutations(),0);assert.ok(f.disk.has('資料/外部.md'));assert.ok(f.a.files['資料/外部.md']);
 await f.a.remove('資料');assert.equal(f.disk.size,0);await f.fast.verify();await f.fast.dispose();
});

test('changed descendants prevent a folder rename instead of treating its cached contents as current',async()=>{
 const f=fixture();await f.a.watchAndList();f.disk.set('資料/子/note.md',note('資料/子/note.md',9));
 await assert.rejects(f.a.rename('資料','移動後'),/外部/);assert.equal(f.mutations(),0);assert.ok(f.disk.has('資料/子/note.md'));assert.equal(f.a.files['資料/子/note.md'].mtime,9);
 await f.fast.verify();await f.fast.dispose();
});

test('a child watcher event during destination checking invalidates the whole folder operation',async()=>{
 const f=fixture();await f.a.watchAndList();const stat=f.a.fs.stat;f.a.fs.stat=async(path:string)=>{if(path==='/lab/移動後')f.a.onFileChange('資料/子/note.md');return stat(path);};
 await assert.rejects(f.a.rename('資料','移動後'),/外部/);assert.equal(f.mutations(),0);f.a.fs.stat=stat;await f.fast.verify();await f.fast.dispose();
});

test('folder permission failures never delegate destructive work or fail unrelated verification',async()=>{
 const f=fixture();await f.a.watchAndList();const list=f.a.fs.readdir;f.a.fs.readdir=async(path:string)=>{if(path==='/lab/資料/子')throw Error('permission denied');return list(path);};
 await assert.rejects(f.a.remove('資料'),/permission/);assert.equal(f.mutations(),0);assert.equal(f.fast.phase,'provisional');assert.ok(f.disk.has('資料/子/note.md'));f.a.fs.readdir=list;await f.fast.verify();await f.fast.dispose();
});

test('late stat results cannot resurrect a folder removed after the stat began',async()=>{
 const f=fixture();await f.a.watchAndList();const stat=f.a.fs.stat;f.a.fs.stat=async(path:string)=>{const result=await stat(path);if(path==='/lab/資料'){for(const key of [...f.disk.keys()])if(inside(key,'資料')){f.disk.delete(key);delete f.a.files[key];}f.a.onFileChange('資料');}return result;};
 await f.fast.ensurePath('資料');assert.equal(f.a.files['資料'],undefined);f.a.fs.stat=stat;await f.fast.verify();assert.equal(f.a.files['資料'],undefined);await f.fast.dispose();
});

test('native no-op renames do not reject the existing source as their destination',async()=>{
 const f=fixture();await f.a.watchAndList();await f.a.rename('資料','資料');await f.a.rename('資料/子/note.md','資料/子/note.md');assert.equal(f.mutations(),0);await f.fast.verify();await f.fast.dispose();
});

test('a stale missing result cannot erase a folder created after the stat began',async()=>{
 const f=fixture();await f.a.watchAndList();const stat=f.a.fs.stat;
 f.a.fs.stat=async(path:string)=>{if(path==='/lab/新規'){const entry=directory('新規');f.disk.set('新規',entry);f.a.quickList('',entry);f.a.onFileChange('新規');throw Object.assign(Error('old missing result'),{code:'ENOENT'});}return stat(path);};
 await f.fast.ensurePath('新規');assert.ok(f.a.files['新規']);f.a.fs.stat=stat;await f.fast.verify();assert.ok(f.a.files['新規']);await f.fast.dispose();
});

test('a folder mutation rejects an in-flight child write before joining the occupied adapter queue',async()=>{
 const f=fixture();await f.a.watchAndList();let finish!:()=>void;f.a.writeGate=new Promise<void>(r=>finish=r);
 const writing=f.a.write('資料/子/note.md');while(!f.a.writeStarted)await new Promise(r=>setImmediate(r));
 try{await assert.rejects(f.a.rename('資料','移動後'),/確認/);assert.equal(f.disk.has('移動後'),false);}finally{finish();await writing;await f.fast.verify();await f.fast.dispose();}
});

test('global verification cannot finish while a foreground folder inventory is still pending',async()=>{
 const f=fixture();await f.a.watchAndList();const list=f.a.fs.readdir,idle=f.scheduler.idle.bind(f.scheduler);
 let finish!:()=>void,entered!:()=>void,first=true;const gate=new Promise<void>(r=>finish=r),started=new Promise<void>(r=>entered=r);
 f.a.fs.readdir=async(path:string)=>{if(path==='/lab/資料'&&first){first=false;entered();await gate;}return list(path);};
 f.scheduler.idle=async()=>{await new Promise(r=>setImmediate(r));await idle();};
 const renaming=f.a.rename('資料','移動後');await started;const scanning=f.fast.verify();await new Promise(r=>setTimeout(r,10));
 try{assert.equal(f.fast.phase,'reconciling');}finally{finish();await Promise.all([renaming,scanning]);await f.fast.dispose();}
 assert.ok(f.disk.has('移動後/子/note.md'));assert.equal(f.a.files['資料'],undefined);
});

test('folder preflight includes cached children created after the background child index was built',async()=>{
 const f=fixture();await f.a.watchAndList();const list=f.a.fs.readdir;let finish!:()=>void,entered!:()=>void;
 const gate=new Promise<void>(r=>finish=r),started=new Promise<void>(r=>entered=r);let first=true;
 f.a.fs.readdir=async(path:string)=>{if(path==='/lab/'&&first){first=false;entered();await gate;}return list(path);};
 const scanning=f.fast.verify();await started;await f.a.write('資料/gone.md');f.disk.delete('資料/gone.md');
 try{await assert.rejects(f.a.remove('資料'),/外部/);assert.equal(f.a.files['資料/gone.md'],undefined);assert.ok(f.disk.has('資料/子/note.md'));}
 finally{finish();await scanning;await f.fast.dispose();}
});

test('a concurrent unchanged child read does not masquerade as an external folder change',async()=>{
 const f=fixture();await f.a.watchAndList();const list=f.a.fs.readdir;
 f.a.fs.readdir=async(path:string)=>{if(path==='/lab/資料/子')await f.a.read('資料/子/note.md');return list(path);};
 await f.a.rename('資料','移動後');assert.equal(f.mutations(),1);assert.ok(f.disk.has('移動後/子/note.md'));await f.fast.verify();await f.fast.dispose();
});
