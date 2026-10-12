import {test} from 'node:test';import assert from 'node:assert/strict';import {IdleScheduler} from '../src/scheduler';
test('background yields while input is active and rechecks input received during the yield',async()=>{
 let time=0,sleeps=0;const s=new IdleScheduler(()=>true,()=>time,async ms=>{time+=ms;sleeps++;if(sleeps===1)s.activity(100);});s.activity(160);await s.idle();assert.ok(time>=180);assert.ok(s.waits>0);
});
test('unload drain cannot deadlock on a hidden app',async()=>{const s=new IdleScheduler(()=>false,()=>0,async()=>{});s.drain();await s.idle();s.stop();await assert.rejects(s.idle());});
test('only the current foreground file bypasses background throttling',()=>{const s=new IdleScheduler();s.prioritize('old.md');s.prioritize('active.md');assert.equal(s.isPriority('active.md'),true);assert.equal(s.isPriority('old.md'),false);});
test('concurrent workspace tabs remain foreground until both finish',()=>{const s=new IdleScheduler();const first=s.beginForeground('a.md'),second=s.beginForeground('b.md');assert.equal(s.isPriority('a.md'),true);assert.equal(s.isPriority('b.md'),true);first();first();assert.equal(s.isPriority('a.md'),false);second();});
test('non-file workspace views also pause scanning until the view opens',async()=>{
 let time=0,sleeps=0;let release=()=>{};
 const s=new IdleScheduler(()=>true,()=>time,async ms=>{time+=ms;if(++sleeps===3)release();});release=s.beginForeground();await s.idle();assert.ok(s.waits>=3);assert.ok(time>=1200);
});
test('stopping during the final yield cannot admit another scan batch',async()=>{
 const s=new IdleScheduler(()=>true,()=>0,async()=>{s.stop();});await assert.rejects(s.idle(),/stopped/);
});
test('small background batches share a time budget while input still preempts the next batch',async()=>{
 let time=0,sleeps=0;const s=new IdleScheduler(()=>true,()=>time,async ms=>{time+=ms;sleeps++;});
 await s.checkpoint();const initial=sleeps;
 for(let i=0;i<100;i++)await s.checkpoint();assert.equal(sleeps,initial);
 time+=4;await s.checkpoint();assert.equal(sleeps,initial+1);
 s.activity(160);await s.checkpoint();assert.ok(s.timing.quietMs>=160);assert.equal(s.timing.waitMs,s.timing.quietMs);assert.ok(s.timing.yields>=3);
 s.stop();await assert.rejects(s.checkpoint(),/stopped/);
});
test('checkpoint waits for foreground completion and distinguishes its wait from input quiet time',async()=>{
 let time=0,release=()=>{};const s=new IdleScheduler(()=>true,()=>time,async ms=>{time+=ms;if(time===80)release();});
 release=s.beginForeground('a.md');await s.checkpoint();assert.equal(s.timing.foregroundMs,80);assert.ok(s.timing.quietMs>=1200);
});

test('heavy initializer quiet time restarts on input without extending the scanner quiet policy',async()=>{
 let time=0,renewed=false;const s=new IdleScheduler(()=>true,()=>time,async ms=>{time+=ms;if(time>=2400&&!renewed){renewed=true;s.activity(1800);}});
 s.activity(1800);await s.idle(5000);assert.ok(time>=7400);const before=time;await s.idle();assert.equal(time-before,12);
});

test('foreground operation tokens survive overlapping holds and expire after the last release',()=>{
 const s=new IdleScheduler(),a=s.beginForeground('a.md'),token=s.foregroundToken('a.md'),b=s.beginForeground('a.md'),other=s.beginForeground('b.md');
 assert.ok(token);assert.equal(s.foregroundToken('a.md'),token);assert.notEqual(s.foregroundToken('b.md'),token);a();assert.equal(s.foregroundToken('a.md'),token);b();assert.equal(s.foregroundToken('a.md'),undefined);other();
 const next=s.beginForeground('a.md');assert.notEqual(s.foregroundToken('a.md'),token);next();
});
