import {test} from 'node:test';import assert from 'node:assert/strict';
import {Localizer,resolveLanguage,translate} from '../src/i18n';
import {inventoryStatus,inventorySaving,comparisonText} from '../src/feedback';
import ja from '../src/locales/ja.json';import en from '../src/locales/en.json';
const {checkCatalogs}=require('../../docs/check-text.cjs');

test('editable language catalogs preserve keys and interpolation placeholders',()=>{
 assert.equal(checkCatalogs(ja,en),Object.keys(ja).length);
 assert.throws(()=>checkCatalogs({name:'{count}'},{name:'value'}),/placeholders/);
 assert.throws(()=>checkCatalogs({name:'value'},{other:'value'}),/keys/);
 assert.throws(()=>checkCatalogs({name:''},{name:'value'}),/Empty/);
 const f:any={phase:'failed'};assert.match(inventoryStatus(f,'none','optimized',true,translate('ja')).next,new RegExp(ja.inventorySetting));
});

test('initial language follows the Obsidian language and uses English for all other locales',()=>{
 for(const locale of ['ja','ja-JP','ja_JP','JA'])assert.equal(resolveLanguage(locale),'ja');
 for(const locale of ['en','en-US','de','fr','zh-CN','','jargon'])assert.equal(resolveLanguage(locale),'en');
 assert.equal(resolveLanguage('ja','en'),'en');assert.equal(resolveLanguage('de','ja'),'ja');
});
test('language overrides persist locally per vault; legacy auto and unknown values use the initial app language',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 const first=new Localizer('ja',storage,'one');assert.equal(first.language,'ja');first.set('en');assert.equal(new Localizer('ja',storage,'one').language,'en');
 assert.equal(new Localizer('ja',storage,'two').language,'ja');data.set(first.key,'auto');assert.equal(new Localizer('ja',storage,'one').language,'ja');
 data.set(first.key,'unknown');assert.equal(new Localizer('fr',storage,'one').language,'en');
});
test('unavailable or rejected language storage does not change the active choice',()=>{
 const l=new Localizer('ja',{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});
 assert.equal(l.language,'ja');assert.throws(()=>l.set('en'));assert.equal(l.language,'ja');assert.throws(()=>new Localizer('en').set('ja'));
});
test('English status explains real work and normal scans do not claim a snapshot was already saved',()=>{
 const t=translate('en'),fast:any={phase:'reconciling',reasonKey:'',reason:'',scanned:100,background:{directories:2,startedAtMs:1},progress:{stage:'listing',path:'Archive',nativePending:true}};
 let f=inventoryStatus(fast,'hidden','optimized',true,t);assert.match(f.work,/Reading.*Archive/);assert.match(f.title,/background/);
 fast.progress.nativePending=false;f=inventoryStatus(fast,'hidden','optimized',true,t);assert.match(f.detail,/app is hidden/);assert.match(f.next,/return/);
 fast.phase='normal';fast.progress.stage='done';fast.reasonKey='ready';f=inventoryStatus(fast,'none','optimized',true,t);assert.equal(f.title,'File list loaded');assert.equal(f.detail,'');assert.equal(f.next,'');
 fast.reasonKey='snapshotFailed';assert.match(inventoryStatus(fast,'none','optimized',true,t).detail,/Could not save/);
 fast.phase='verified';fast.inventoryMs=100;fast.normalInventoryMs=3000;assert.match(inventorySaving(fast,t),/2.9 s faster/);
 assert.match(comparisonText({normalMs:5000,optimizedMs:6000,savedMs:-1000,percent:-20,normalCount:2,optimizedCount:3,variable:true},t),/1.0 s.*20%.*slower.*timings vary/);
});
