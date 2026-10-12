import {test} from 'node:test';import assert from 'node:assert/strict';
import {startMetadataPreload} from '../src/metadata-preload';

test('early metadata preload uses the exact memoized promise consumed by normal initialization',async()=>{
 let reads=0,finish!:()=>void;const promise=new Promise<void>(r=>finish=r);
 const cache={initialized:false,fileCache:{},metadataCache:{},preloadPromise:null as Promise<void>|null,
   _preload(){reads++;return promise;},preload(){return this.preloadPromise??=this._preload();}};
 assert.equal(startMetadataPreload(cache,'1.14.4'),true);assert.equal(cache.preloadPromise,promise);
 assert.equal(cache.preload(),promise);assert.equal(startMetadataPreload(cache,'1.14.4'),true);assert.equal(reads,1);
 finish();await cache.preload();assert.equal(cache.initialized,false);
});

test('unsupported versions, incomplete interfaces and already initialized caches are left untouched',()=>{
 let calls=0;const cache={initialized:false,fileCache:{},metadataCache:{},preload(){calls++;},_preload(){}};
 assert.equal(startMetadataPreload(cache,'1.14.5'),false);assert.equal(startMetadataPreload({...cache,initialized:true},'1.14.4'),false);
 assert.equal(startMetadataPreload({...cache,_preload:undefined},'1.14.4'),false);assert.equal(startMetadataPreload(undefined,'1.14.4'),false);assert.equal(calls,0);
});

test('failure remains visible to normal initialization and cannot escape plugin startup',async()=>{
 const error=Error('IndexedDB unavailable'),promise=Promise.reject(error);
 const cache={fileCache:{},metadataCache:{},_preload(){},preload(){return promise;}};
 assert.equal(startMetadataPreload(cache,'1.13.8'),true);assert.equal(cache.preload(),promise);await assert.rejects(cache.preload(),e=>e===error);
 assert.equal(startMetadataPreload({...cache,preload(){throw error;}},'1.14.4'),false);
});
