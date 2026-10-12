import {test} from 'node:test';import assert from 'node:assert/strict';
import {patchMethods} from '../src/method-patch';

test('optional hooks roll back descriptors on failure and reject accessor contracts',()=>{
 const host:any={},original=()=>1,replacement=()=>2;Object.defineProperty(host,'first',{value:original,writable:true,configurable:true,enumerable:false});
 Object.defineProperty(host,'second',{get:()=>original,configurable:true});const before=Object.getOwnPropertyDescriptors(host);
 assert.equal(patchMethods([{host,name:'first',replacement},{host,name:'second',replacement}]),null);
 assert.deepEqual(Object.getOwnPropertyDescriptors(host),before);
});

test('cleanup preserves later wrappers and continues if a later owner locks a retired hook',()=>{
 const host={first:()=>1,second:()=>2},first=()=>3,second=()=>4,nativeSecond=host.second;
 const undo=patchMethods([{host,name:'second',replacement:second},{host,name:'first',replacement:first}])!;
 Object.defineProperty(host,'first',{writable:false,configurable:false});assert.doesNotThrow(undo);assert.equal(host.second,nativeSecond);assert.doesNotThrow(undo);
 const later={run:()=>1},wrapped=()=>2,release=patchMethods([{host:later,name:'run',replacement:wrapped}])!,other=()=>wrapped();later.run=other;release();assert.equal(later.run,other);
});
