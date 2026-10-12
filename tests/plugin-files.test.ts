import {test} from 'node:test';import assert from 'node:assert/strict';
import {PluginFiles} from '../src/plugin-files';
// Obsidian supplies browser timers; this suite runs in Node.
(globalThis as any).window=globalThis;
const dir='.obsidian/plugins/anything',path=dir+'/main.js',key=JSON.stringify(['1.14.4',dir,'1']);
function fixture(size?:number){
 let nativeCalls=0,fetches=0,saved:any,body='fresh source',failure:any=null;
 const native=function(this:any,p:string){assert.equal(this,fs);nativeCalls++;if(failure)return Promise.reject(failure);return Promise.resolve('native '+p);};
 const fs={read:native};let chain=Promise.resolve<any>(null);
 const a={fs,getFullPath:(p:string)=>'/vault/'+p,getResourcePath:(p:string)=>'http://localhost/_capacitor_file_/vault/'+p,queue(fn:()=>any){chain=chain.then(fn,fn);return chain;},read(p:string){return this.queue(()=>this.fs.read(this.getFullPath(p)));}};
 const fetcher=async(url:any,options:any)=>{fetches++;assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');return new Response(body,{headers:{'content-type':'text/javascript'}});};
 const port:any={api:'1.14.4',adapter:a,configDir:'.obsidian',manifests:{anything:{dir,version:'1'}},load:()=>size===undefined?{}:{[key]:size},save:(v:any)=>{saved={...v};},fetch:fetcher};
 const io=new PluginFiles(port);return {io,a,fs,port,native,nativeCalls:()=>nativeCalls,fetches:()=>fetches,saved:()=>saved,body:(value:string)=>{body=value;},fail:(e:any)=>{failure=e;}};
}
test('first load learns size through the native call and preserves its promise and receiver',async()=>{
 const f=fixture();f.io.install();const p=f.fs.read('/vault/'+path);assert.equal(await p,'native /vault/'+path);assert.equal(f.nativeCalls(),1);assert.equal(f.fetches(),0);
 f.io.checkpoint();assert.ok(f.saved()[key]>0);f.io.dispose();assert.equal(f.fs.read,f.native);
});
test('large sources stream fresh bytes while the original adapter queue retains invocation order',async()=>{
 const f=fixture(2*1024*1024),padding=' '.repeat(1024*1024),text='\uFEFFconst 日本語="😀";\r\n'+padding;f.io.install();f.body(text);
 assert.equal(await f.a.read(path),text);assert.equal(f.nativeCalls(),0);
 f.body('changed disk source'+padding);assert.equal(await f.a.read(path),'changed disk source'+padding);assert.equal(f.fetches(),2);f.io.dispose();
});
test('unrelated note and mutable settings reads retain the exact native promise without streaming',async()=>{
 const f=fixture(2*1024*1024),expected=Promise.resolve('same');f.fs.read=function(){return expected;};f.io.install();
 assert.equal(f.fs.read('/vault/.obsidian/plugins/anything/data.json'),expected);assert.equal(f.fs.read('/vault/note.md'),expected);assert.equal(f.fetches(),0);f.io.dispose();
});
test('small sources, a new plugin version and unknown Android versions use the native reader',async()=>{
 for(const configure of [(p:any)=>{},(p:any)=>{p.manifests.anything.version='2';}]){const f=fixture(100);configure(f.port);f.io.install();await f.a.read(path);assert.equal(f.fetches(),0);f.io.dispose();}
 const f=fixture(2*1024*1024);f.port.api='99';assert.equal(f.io.install(),false);assert.equal(f.fs.read,f.native);
});
test('invalid local responses, missing files and malformed UTF8 fall back to normal reads',async()=>{
 for(const response of [new Response('missing',{status:404}),new Response('<html>app</html>',{headers:{'content-type':'text/html'}}),new Response(new Uint8Array([0xff]))]){
  const f=fixture(2*1024*1024);f.port.fetch=async()=>response;f.io.install();assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(f.io.timing.fallbacks,1);f.io.dispose();
 }
 const f=fixture(2*1024*1024),error=Error('native missing');f.fail(error);f.port.fetch=async()=>{throw Error('not supported');};f.io.install();await assert.rejects(f.a.read(path),e=>e===error);f.io.dispose();
});
test('non-local resources and invalid directories never install a read hook',()=>{
 for(const url of ['https://example.com/main.js','http://localhost:8000/_capacitor_file_/a','file:///a','http://localhost/app.js']){
  const f=fixture(2*1024*1024);f.a.getResourcePath=()=>url;assert.equal(f.io.install(),false);assert.equal(f.fs.read,f.native);
 }
 const f=fixture();f.port.manifests.anything.dir='.obsidian/plugins/../notes';assert.equal(f.io.install(),false);
});
test('unloading preserves later hooks and storage errors never block plugin loading',async()=>{
 const f=fixture();f.port.save=()=>{throw Error('full');};f.io.install();const inside=f.fs.read,later=function(this:any,p:string){return inside.call(this,p);};f.fs.read=later;
 await f.a.read(path);assert.doesNotThrow(()=>f.io.dispose());assert.equal(f.fs.read,later);await f.a.read(path);assert.equal(f.fetches(),0);
});
test('stream read stays inside the queue until completion; the next plugin cannot overtake it',async()=>{
 const f=fixture(2*1024*1024);let finish!:(value:Response)=>void;const events:string[]=[];
 f.port.fetch=()=>{events.push('first read');return new Promise<Response>(resolve=>{finish=resolve;});};f.io.install();
 const one=f.a.read(path),two=f.a.queue(()=>{events.push('second initializer');return 2;});await Promise.resolve();assert.deepEqual(events,['first read']);
 finish(new Response('current source'));assert.equal(await one,'current source');assert.equal(await two,2);assert.deepEqual(events,['first read','second initializer']);f.io.dispose();
});
test('a hung local request aborts and falls back without hanging the native loader',async()=>{
 const f=fixture(2*1024*1024);f.port.timeoutMs=5;let signal:AbortSignal;
 f.port.fetch=(_url:any,options:any)=>new Promise((_resolve,reject)=>{signal=options.signal;signal.addEventListener('abort',()=>reject(Error('aborted')));});f.io.install();
 assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(signal!.aborted,true);assert.equal(f.nativeCalls(),1);f.io.dispose();
});

test('partial responses and inconsistent byte lengths never become executable source',async()=>{
 for(const make of [
  ()=>new Response('partial',{status:206}),
  ()=>new Response('partial',{headers:{'content-range':'bytes 0-6/100'}}),
  ()=>new Response('short',{headers:{'content-length':'100'}}),
  ()=>new Response('too long',{headers:{'content-length':'2'}}),
  ()=>new Response('source',{headers:{'content-length':'invalid'}}),
  ()=>new Response('source',{headers:{'content-encoding':'gzip','content-length':'6'}}),
  ()=>new Response('<html>app</html>',{headers:{'content-type':'Text/HTML; charset=utf-8'}})
 ]){
  const f=fixture(2*1024*1024);f.port.fetch=async()=>make();f.io.install();
  assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(f.io.timing.streamReads,0);assert.equal(f.io.timing.fallbacks,1);f.io.dispose();
 }
});

test('streamed UTF8 preserves BOM and split multibyte characters and checks bytes rather than characters',async()=>{
 const f=fixture(2*1024*1024),source='\uFEFF日本語😀\r\n',bytes=new TextEncoder().encode(source);
 f.port.fetch=async()=>new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{headers:{'content-length':String(bytes.length)}});
 f.io.install();assert.equal(await f.a.read(path),source);assert.equal(f.io.timing.bytes,bytes.length);f.io.dispose();
});

test('an oversized body is cancelled before reading the remainder and falls back inside the queue',async()=>{
 const f=fixture(2*1024*1024);let cancelled=false,pulls=0;
 f.port.fetch=async()=>new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(17*1024*1024));if(pulls===3)controller.close();},cancel(){cancelled=true;}},{highWaterMark:0}));
 f.io.install();assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(cancelled,true);assert.equal(pulls,2);assert.equal(f.io.timing.streamReads,0);f.io.dispose();
});

test('the deadline covers a stalled response body even when the stream ignores abort',async()=>{
 const f=fixture(2*1024*1024);f.port.timeoutMs=5;let cancelled=false;
 f.port.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('unfinished source'));},cancel(){cancelled=true;}}));
 f.io.install();const first=f.a.read(path),next=f.a.queue(()=>42);
 assert.equal(await first,'native /vault/'+path);assert.equal(await next,42);assert.equal(cancelled,true);assert.equal(f.io.timing.streamReads,0);f.io.dispose();
});

test('the loader deadline also bounds fetch implementations that ignore abort',async()=>{
 const f=fixture(2*1024*1024);f.port.timeoutMs=5;f.port.fetch=()=>new Promise(()=>{});f.io.install();
 assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(f.io.timing.fallbacks,1);f.io.dispose();
});

test('synchronous work cannot bypass the deadline before the timeout task gets a turn',async()=>{
 const f=fixture(2*1024*1024);f.port.timeoutMs=5;
 f.port.fetch=()=>{const until=performance.now()+15;while(performance.now()<until){}return Promise.resolve(new Response('late source'));};f.io.install();
 assert.equal(await f.a.read(path),'native /vault/'+path);assert.equal(f.io.timing.streamReads,0);f.io.dispose();
});

test('repeated installation keeps a single hook and restores the original reader',()=>{
 const f=fixture();assert.equal(f.io.install(),true);const first=f.fs.read;assert.equal(f.io.install(),true);assert.equal(f.fs.read,first);f.io.dispose();assert.equal(f.fs.read,f.native);assert.equal(f.io.install(),false);
});
