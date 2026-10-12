import {isRecord,isMethod} from './runtime';
import type {Entry} from './fast-start';

export interface CachedEntry {type:'folder'|'file';realpath:string;ctime?:number;mtime?:number;size?:number;}
/** The inspected Android inventory contract. Native I/O responses remain unknown. */
export interface AndroidInventoryAdapter {
  [owner:symbol]:unknown;
  basePath:string;files:Record<string,CachedEntry|undefined>;
  fs:{watch(path:string):Promise<unknown>;readdir(path:string):Promise<unknown>;stat(path:string):Promise<unknown>};
  watchAndList:(...args:unknown[])=>Promise<unknown>;
  quickList(parent:string,entry:Entry):void;
  queue<T>(run:()=>T|Promise<T>):Promise<T>;
  removeFile(path:string):void;
  onFileChange:(path:string,...args:unknown[])=>unknown;
  getFullRealPath(path:string):string;getRealPath(path:string):string;
}
export function isAndroidInventoryAdapter(value:unknown):value is AndroidInventoryAdapter {
  if(!isRecord(value))return false;const fs=value.fs;
  return isRecord(value)&&typeof value.basePath==='string'&&isRecord(value.files)&&
    ['watchAndList','quickList','queue','removeFile','onFileChange','getFullRealPath','getRealPath'].every(k=>isMethod(value[k]))&&
    isRecord(fs)&&['watch','readdir','stat'].every(k=>isMethod(fs[k]));
}
