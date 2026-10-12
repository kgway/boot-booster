import {test} from 'node:test';import assert from 'node:assert/strict';
import {compareStartups,comparisonText,inventoryStatus,inventorySaving} from '../src/feedback';import type {StartupRun} from '../src/benchmark';
function run(mode:'optimized'|'measurement-only',ms:number):StartupRun{return {id:mode+ms,startedAt:'2026-10-12T00:00:00Z',kind:'startup',status:'complete',environment:{bootBooster:'1.11.0',api:'1.14.4',model:'Lab'},condition:{enabled:true,mode},configuration:{settingsLoaded:true,fastMode:'always',scope:{all:true,folderCount:0},startup:{workspace:true,pluginFiles:true,fastTabs:false}},bootBoosterOnloadMs:10,recorderSetupMs:0,milestones:{pluginStartedMs:500,layoutReadyMs:ms,uiReadyMs:ms,metadataResolvedMs:ms+100,verificationMs:null,pluginsSettledMs:ms,settledMs:ms+2000},phases:{},plugins:{example:{version:'1',beforeRecorder:false,loads:[]}},counts:{files:10000,tabs:40,deferredTabs:39},fastStart:null,startup:null,interaction:{firstMs:null,events:0,hidden:false},unavailable:[]};}
test('startup reference is measured locally with medians and signed differences',()=>{
 const history=[run('measurement-only',10000),run('measurement-only',12000),run('optimized',4000),run('optimized',6000)],c=compareStartups(history)!;
 assert.equal(c.normalMs,11000);assert.equal(c.optimizedMs,5000);assert.equal(c.savedMs,6000);assert.equal(c.normalCount,2);assert.ok(comparisonText(c).includes('短縮'));
 assert.ok(comparisonText(compareStartups([run('measurement-only',3000),run('optimized',4000)])).includes('増加'));assert.equal(compareStartups([run('optimized',1000)]),null);
});
test('different devices, versions, plugins, files, tabs and settings never share a reference',()=>{
 const normal=run('measurement-only',10000);const edits:((r:StartupRun)=>void)[]=[r=>r.environment.model='Other',r=>r.environment.bootBooster='other',r=>r.plugins.example.version='2',r=>r.counts.files=9999,r=>r.counts.tabs=41,r=>(r.configuration as any).startup.workspace=false,r=>(r.configuration as any).scope.all=false,r=>(r.configuration as any).fastMode='auto'];
 for(const edit of edits){const optimized=run('optimized',3000);edit(optimized);assert.equal(compareStartups([normal,optimized]),null);}
});
test('incomplete, hidden, failed and interacted-before-ready runs are excluded',()=>{
 const edits:((r:StartupRun)=>void)[]=[r=>r.status='interrupted',r=>r.status='timeout',r=>r.kind='late-load',r=>r.interaction.hidden=true,r=>r.interaction.firstMs=1000,r=>r.phases.readingFiles=[{startMs:1,durationMs:1,ok:false}],r=>r.fastStart={phase:'failed'}];
 for(const edit of edits){const r=run('optimized',3000);edit(r);assert.equal(compareStartups([run('measurement-only',10000),r]),null);}
});
test('selected folders require the same opaque identity; legacy records lack that guarantee',()=>{
 const normal=run('measurement-only',10000),fast=run('optimized',3000);normal.configuration.scope={all:false,folderCount:1};fast.configuration.scope={all:false,folderCount:1};assert.equal(compareStartups([normal,fast]),null);
 normal.configuration.scope={all:false,folderCount:1,identity:'one'};fast.configuration.scope={all:false,folderCount:1,identity:'two'};assert.equal(compareStartups([normal,fast]),null);
 fast.configuration.scope={all:false,folderCount:1,identity:'one'};assert.equal(compareStartups([normal,fast])?.savedMs,7000);
});
test('live status separates native I/O, input waits, completion and empty selection',()=>{
 const fast:any={phase:'reconciling',reason:'',scanned:123,background:{directories:2,startedAtMs:100},progress:{stage:'listing',path:'Archive',nativePending:true}};
 assert.match(inventoryStatus(fast,'input','optimized',true).work,/Archive.*取得中/);assert.match(inventoryStatus(fast,'input','optimized',true).title,/バックグラウンド/);
 fast.progress.stage='watching';assert.match(inventoryStatus(fast,'input','optimized',true).work,/監視を準備/);assert.match(inventoryStatus(fast,'input','optimized',true).title,/バックグラウンド/);fast.progress.stage='listing';
 fast.progress.nativePending=false;assert.match(inventoryStatus(fast,'input','optimized',true).detail,/入力やスクロール/);assert.match(inventoryStatus(fast,'hidden','optimized',true).detail,/非表示/);
 fast.phase='verified';assert.match(inventoryStatus(fast,'none','optimized',true).title,/完了/);fast.phase='unsupported';fast.reason='対象フォルダが選択されていないため通常起動します。';assert.match(inventoryStatus(fast,'none','optimized',true).detail,/選択されていない/);
 assert.match(inventoryStatus(null,'none','measurement-only',true).title,/通常起動/);
});
test('inventory savings never invent a baseline or add overlapping background work',()=>{
 const fast:any={phase:'verified',inventoryMs:100,normalInventoryMs:null,background:{nativeListMs:99999}};assert.equal(inventorySaving(fast),'');fast.normalInventoryMs=3000;assert.match(inventorySaving(fast),/2.9秒短縮/);fast.normalInventoryMs=10;assert.match(inventorySaving(fast),/増加/);fast.phase='normal';assert.equal(inventorySaving(fast),'');
});
test('next action follows actual work and never asks users to resume a pending native read',()=>{
 const fast:any={phase:'reconciling',reason:'',scanned:1,background:{directories:1,startedAtMs:100},progress:{stage:'listing',path:'Archive',nativePending:false}};
 assert.match(inventoryStatus(fast,'hidden','optimized',true).next,/アプリに戻る/);
 assert.match(inventoryStatus(fast,'foreground','optimized',true).next,/操作が落ち着く/);
 fast.progress.nativePending=true;assert.match(inventoryStatus(fast,'hidden','optimized',true).next,/取得後/);
 fast.progress.stage='watching';assert.match(inventoryStatus(fast,'input','optimized',true).next,/監視.*準備/);
 fast.phase='verified';assert.equal(inventoryStatus(fast,'none','optimized',true).next,'');
 fast.phase='failed';assert.match(inventoryStatus(fast,'none','optimized',true).next,/使わない.*開き直/);
 fast.phase='unsupported';fast.reason='対象フォルダが選択されていないため通常起動します。';assert.match(inventoryStatus(fast,'none','optimized',true).next,/追加.*Vault全体/);
});
test('UI comparison uses frozen startup conditions even when background recording is interrupted',()=>{
 const normal=run('measurement-only',8000),fast=run('optimized',3000);for(const r of [normal,fast])r.uiReadyState={files:10000,tabs:40,deferredTabs:39,hidden:false,interacted:false};
 fast.status='interrupted';fast.interaction.hidden=true;fast.interaction.firstMs=4000;fast.counts.tabs=13;
 assert.equal(compareStartups([normal,fast])?.savedMs,5000);
 fast.uiReadyState!.interacted=true;assert.equal(compareStartups([normal,fast]),null);fast.uiReadyState!.interacted=false;fast.uiReadyState!.hidden=true;assert.equal(compareStartups([normal,fast]),null);
 fast.uiReadyState!.hidden=false;fast.milestones.uiReadyMs=null;assert.equal(compareStartups([normal,fast]),null);
});
