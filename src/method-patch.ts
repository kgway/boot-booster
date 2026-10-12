import {isRecord} from './runtime';
export type MethodPatch={host:unknown;name:string;replacement:(...args:never[])=>unknown};
/** Optional hooks install as a unit. Preserve descriptors and later wrappers. */
export function patchMethods(patches:MethodPatch[]):(()=>void)|null {
 const undo:(()=>void)[]=[];
 const restore=()=>{for(const dispose of undo.reverse())try{dispose();}catch{/* A later owner can lock a retired wrapper in place. */}undo.length=0;};
 try{
  for(const {host,name,replacement} of patches){
   if(!isRecord(host))throw Error('Method host unavailable');
   const descriptor=Object.getOwnPropertyDescriptor(host,name);
   // Accessors and explicitly locked methods are not supported contracts.
   let inherited=descriptor;let prototype:unknown=host;
   while(!inherited&&isRecord(prototype=Object.getPrototypeOf(prototype) as unknown))inherited=Object.getOwnPropertyDescriptor(prototype,name);
   if(!inherited||!('value' in inherited)||!inherited.writable||typeof inherited.value!=='function')throw Error('Method unavailable');
   Object.defineProperty(host,name,descriptor?{...descriptor,value:replacement}:{value:replacement,writable:true,configurable:true,enumerable:true});
   undo.push(()=>{if(host[name]===replacement){if(descriptor)Object.defineProperty(host,name,descriptor);else delete host[name];}});
  }
  return restore;
 }catch{restore();return null;}
}
