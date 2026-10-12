import {supportsAndroidAdapter} from './compatibility';
import {patchMethods} from './method-patch';
import {record,isRecord,isMethod,isThenable} from './runtime';
const MIN=512*1024,MAX=32*1024*1024;
export interface PluginFilePort {
 api:string;adapter:unknown;manifests:unknown;configDir:string;
 load():unknown;save(sizes:Record<string,number>):void;
 fetch?:typeof fetch;timeoutMs?:number;
}
/** Fresh source reads through Android's local file server, inside the original
 * adapter queue. Never evaluate code, preload another plugin, or cache its source. */
export class PluginFiles {
 private stopped=false;private disposeRead:(()=>void)|null=null;
 private sizes:Record<string,number>={};private dirty=false;
 readonly timing={nativeReads:0,streamReads:0,fallbacks:0,bytes:0,streamMs:0};
 reason='';
 constructor(private port:PluginFilePort){}
 install():boolean{
  if(this.disposeRead)return true;
  const p=this.port,a=record(p.adapter),fs=record(a.fs),original=fs.read;
  if(this.stopped||!supportsAndroidAdapter(p.api)||!isMethod(original)||!isMethod(a.queue)||!isMethod(a.getFullPath)||!isMethod(a.getResourcePath))return false;
  try{const saved=p.load();if(isRecord(saved))for(const [k,v] of Object.entries(saved))if(typeof v==='number'&&Number.isFinite(v)&&v>=0)this.sizes[k]=v;}catch{/* Learn sizes from native reads instead. */}
  const targets=new Map<string,{key:string;uri:string}>();
  for(const value of Object.values(record(p.manifests))){
   const m=record(value),dir=m.dir;if(typeof dir!=='string'||!dir.startsWith(p.configDir+'/plugins/')||dir.includes('\\')||dir.split('/').some((x:string)=>!x||x==='.'||x==='..'))continue;
   try{const path=dir+'/main.js',uri=a.getResourcePath(path);if(typeof uri!=='string')continue;const url=new URL(uri);
    if(!['http:','https:'].includes(url.protocol)||url.hostname!=='localhost'||url.port||url.search||url.hash||!url.pathname.startsWith('/_capacitor_file_/'))continue;
    const full=a.getFullPath(path);if(typeof full==='string')targets.set(full,{key:JSON.stringify([p.api,dir,m.version??'']),uri});
   }catch{/* An invalid native resource URL uses the native reader. */}
  }
  if(!targets.size){this.reason='No eligible plugin files';return false;}
  const native=(receiver:unknown,args:unknown[],key:string)=>{
   this.timing.nativeReads++;
   const result=original.apply(receiver,args);
   const learn=(value:unknown)=>{if(!this.stopped&&typeof value==='string'&&this.sizes[key]!==value.length){this.sizes[key]=value.length;this.dirty=true;}};
   if(isThenable(result))void Promise.resolve(result).then(learn,()=>{});else learn(result);
   return result;
  };
  const read=(receiver:unknown,args:unknown[])=>{
   const target=typeof args[0]==='string'?targets.get(args[0]):undefined;if(this.stopped||!target)return original.apply(receiver,args);
   const size=this.sizes[target.key];
   if(!(size>=MIN&&size<=MAX))return native(receiver,args,target.key);
   return this.stream(target.uri,target.key).catch(()=>{this.timing.fallbacks++;return native(receiver,args,target.key);});
  };
  this.disposeRead=patchMethods([{host:fs,name:'read',replacement:function(this:unknown,...args:unknown[]){return read(this,args);}}]);
  if(!this.disposeRead)return false;
  this.reason='Faster reads for large plugin program files';return true;
 }
 private async stream(uri:string,key:string):Promise<string>{
  const controller=new AbortController(),begin=performance.now(),timeout=this.port.timeoutMs??2000,expires=begin+timeout;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,complete=false;
  let timer:number|undefined;
  // Abort alone is insufficient if a bridge or another wrapper ignores the
  // signal. Bound both headers and body reads so the native queue can resume.
  const deadline=new Promise<never>((_resolve,reject)=>{timer=window.setTimeout(()=>{
   reject(Error('Local file read timed out'));controller.abort();
  },timeout);});
  try{
   const request=Promise.resolve((this.port.fetch??window.fetch.bind(window))(uri,{cache:'no-store',redirect:'error',credentials:'omit',signal:controller.signal}));
   void request.then(response=>{if(controller.signal.aborted)void response.body?.cancel().catch(()=>{});},()=>{});
   const response=await Promise.race([request,deadline]);
   reader=response.body?.getReader();
   if(performance.now()>=expires)throw Error('Local file read timed out');
   const type=response.headers.get('content-type')?.toLowerCase()??'';
   const encoding=response.headers.get('content-encoding')?.trim().toLowerCase();
   if(response.status!==200||response.redirected||response.headers.has('content-range')||!reader||
    /^(text\/html|application\/xhtml\+xml)(?:;|$)/.test(type)||(encoding&&encoding!=='identity'))throw Error('Local file response unavailable');
   const rawLength=response.headers.get('content-length');
   const length=rawLength===null?null:Number(rawLength);
   if(rawLength!==null&&(!/^\d+$/.test(rawLength)||!Number.isSafeInteger(length)||(length!==null&&length>MAX)))throw Error('Invalid source length');
   const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),parts:string[]=[];let bytes=0;
   for(;;){
    // Immediately available chunks can keep the microtask queue busy without
    // letting the timeout task run. Check elapsed time at each boundary too.
    if(performance.now()>=expires)throw Error('Local file read timed out');
    const chunk=await Promise.race([reader.read(),deadline]);if(chunk.done)break;
    bytes+=chunk.value.byteLength;if(bytes>MAX||(length!==null&&bytes>length))throw Error('Source exceeds streaming limit');
    parts.push(decoder.decode(chunk.value,{stream:true}));
   }
   if(length!==null&&bytes!==length)throw Error('Incomplete source response');
   parts.push(decoder.decode());const text=parts.join('');
   if(performance.now()>=expires)throw Error('Local file read timed out');complete=true;
   this.timing.streamReads++;this.timing.bytes+=bytes;this.timing.streamMs+=performance.now()-begin;
   if(!this.stopped&&this.sizes[key]!==text.length){this.sizes[key]=text.length;this.dirty=true;}return text;
  }finally{
   window.clearTimeout(timer);
   if(!complete){controller.abort();try{void reader?.cancel().catch(()=>{});}catch{/* The bridge may already have closed the reader. */}}
   try{reader?.releaseLock();}catch{/* Pending native reads can retain the lock until cancellation. */}
  }
 }
 checkpoint():void{if(!this.dirty||this.stopped)return;try{this.port.save(this.sizes);this.dirty=false;}catch{/* Retry optional size persistence at the next checkpoint. */}}
 dispose():void{this.checkpoint();this.stopped=true;this.disposeRead?.();this.disposeRead=null;}
}
