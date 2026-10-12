import {test} from 'node:test';import assert from 'node:assert/strict';
import {IdleScheduler} from '../src/scheduler';import {protectForeground} from '../src/foreground';
test('mobile tab rendering holds background work until the native UI promise settles',async()=>{
 const scheduler=new IdleScheduler();let finish!:()=>void;const promise=new Promise<void>(r=>finish=r);
 const host={show(){assert.equal(this,host);return promise;}};const original=host.show;
 const dispose=protectForeground(host,'show',scheduler,()=>true);
 assert.equal(host.show(),promise);assert.equal(scheduler.hasForeground(),true);finish();await promise;assert.equal(scheduler.hasForeground(),false);dispose();assert.equal(host.show,original);
});
test('overlapping UI requests release independently and native errors still reach callers',async()=>{
 const scheduler=new IdleScheduler(),ends:(()=>void)[]=[];const host={show(){return new Promise<void>(r=>ends.push(r));}};
 protectForeground(host,'show',scheduler,()=>true);const first=host.show(),second=host.show();ends[0]();await first;assert.equal(scheduler.hasForeground(),true);ends[1]();await second;assert.equal(scheduler.hasForeground(),false);
 const error=Error('native UI'),failing={show(){return Promise.reject(error);}};protectForeground(failing,'show',scheduler,()=>true);await assert.rejects(failing.show(),e=>e===error);assert.equal(scheduler.hasForeground(),false);
 const sync={show(){throw error;}};protectForeground(sync,'show',scheduler,()=>true);assert.throws(()=>sync.show(),e=>e===error);assert.equal(scheduler.hasForeground(),false);
});
test('idle operation and later wrappers keep their behavior; inherited methods restore correctly',()=>{
 const scheduler=new IdleScheduler();const prototype={show(){return 7;}};const host=Object.create(prototype);
 const dispose=protectForeground(host,'show',scheduler,()=>false);assert.equal(host.show(),7);assert.equal(scheduler.hasForeground(),false);dispose();assert.equal(Object.prototype.hasOwnProperty.call(host,'show'),false);
 const undo=protectForeground(host,'show',scheduler,()=>true),inside=host.show;host.show=function(){return inside.call(this);};undo();assert.equal(host.show(),7);assert.equal(scheduler.hasForeground(),false);
});

test('rapid tab overview taps share one native opening and preserve its promise',async()=>{
 const scheduler=new IdleScheduler();let calls=0,finish!:()=>void,active=true;
 const host={show(){calls++;return new Promise<void>(r=>finish=r);}};
 const dispose=protectForeground(host,'show',scheduler,()=>active,{coalesce:true});
 const first=host.show();assert.equal(host.show(),first);active=false;assert.equal(host.show(),first);assert.equal(calls,1);
 finish();await first;assert.equal(scheduler.hasForeground(),false);
 const next=host.show();assert.notEqual(next,first);assert.equal(calls,2);finish();await next;dispose();
});

test('coalesced tab opening failures are retained and a later tap can retry',async()=>{
 const scheduler=new IdleScheduler(),error=Error('screenshot failure');let reject!:(e:Error)=>void,calls=0;
 const host={show(){calls++;return new Promise<void>((_r,j)=>reject=j);}};
 const dispose=protectForeground(host,'show',scheduler,()=>true,{coalesce:true});
 const first=host.show(),again=host.show();assert.equal(first,again);const failed=assert.rejects(first,e=>e===error);
 reject(error);await failed;assert.equal(scheduler.hasForeground(),false);
 const next=host.show();assert.equal(calls,2);const retried=assert.rejects(next,e=>e===error);reject(error);await retried;dispose();
});
