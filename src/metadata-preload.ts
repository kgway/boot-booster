import {supportsAndroidAdapter} from './compatibility';
import {isMethod,isThenable,record} from './runtime';

/** Start Obsidian's memoized cache read while community plugins initialize.
 * Its normal preload/initialize calls still own completion and error handling. */
export function startMetadataPreload(value:unknown,api:string):boolean {
  const cache=record(value);
  if(!supportsAndroidAdapter(api)||cache?.initialized===true||
    !isMethod(cache.preload)||!isMethod(cache._preload)||
    !cache.fileCache||!cache.metadataCache)return false;
  try {
    const result=cache.preload();
    // Observing a rejection must not replace the promise that initialize awaits.
    if(isThenable(result))void Promise.resolve(result).catch(()=>{});
    return true;
  }catch{return false;}
}
