import type {StartupRun} from './benchmark';
import type {FastStart} from './fast-start';
import type {IdleScheduler} from './scheduler';
import {record} from './runtime';

import {japanese,Translator} from './i18n';
export const seconds=(ms:number,t:Translator=japanese):string=>t('seconds',{value:(ms/1000).toFixed(1)});
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function inventoryStatus(fast:FastStart|null,waiting:IdleScheduler['waitingFor'],mode:'optimized'|'measurement-only',available:boolean,t:Translator=japanese):{title:string;detail:string;work:string;next:string} {
  const simple=(key:Parameters<Translator>[0])=>({title:t(key),detail:'',work:'',next:''});
  if(mode==='measurement-only')return simple('normalStartup');
  if(!available)return simple('unsupportedEnvironment');
  if(!fast)return simple('normalList');
  const reason=fast.reasonKey?t(fast.reasonKey,fast.reasonArgs):fast.reason;
  if(fast.phase==='unsupported')return {...simple('normalList'),detail:reason,next:fast.reasonKey==='emptyScope'||reason.includes('対象フォルダが選択されていない')?t('noFolders'):''};
  if(fast.phase==='failed')return {...simple('failed'),detail:t('failedHelp'),next:t('recovery',{setting:t('inventorySetting'),off:t('off')})};
  if(fast.phase==='verified')return {...simple('verified'),detail:t('verifiedCount',{count:fast.scanned.toLocaleString()})};
  // A completed normal scan schedules a snapshot for later; it is not saved yet.
  if(fast.phase==='normal')return {...simple(fast.progress.stage==='normal-reading'?'normalReading':'normalLoaded'),detail:fast.reasonKey==='snapshotFailed'?reason:''};
  const count=t('counts',{entries:fast.scanned.toLocaleString(),folders:fast.background.directories.toLocaleString()});
  const folder=fast.progress.path||t('vaultRoot');
  const work=fast.progress.stage==='waiting-layout'?t('waitingLayout'):fast.progress.stage==='watching'?t('watching'):fast.progress.stage==='indexing'?t('indexing'):fast.progress.nativePending?t('listing',{folder}):fast.progress.stage==='finishing'?t('finishing'):fast.background.startedAtMs===null?t('afterUi'):t('comparing',{folder});
  if(waiting!=='none'&&waiting!=='stopped'&&!fast.progress.nativePending){
    const reason=t(({hidden:'waitHidden',foreground:'waitForeground',input:'waitInput'} as const)[waiting]);
    return {title:t('waiting'),detail:reason+' '+count,work,next:t(waiting==='hidden'?'resumeVisible':'resumeIdle')};
  }
  const next=fast.progress.stage==='waiting-layout'?t('afterLayout'):fast.progress.stage==='watching'?t('afterWatch'):fast.progress.nativePending?t('afterRead'):'';
  return {title:t('background'),detail:count,work,next};
}
export function inventorySaving(fast:FastStart|null,t:Translator=japanese):string {
  if(!fast||!['provisional','reconciling','verified'].includes(fast.phase)||!finite(fast.inventoryMs)||!finite(fast.normalInventoryMs))return '';
  const difference=fast.normalInventoryMs-fast.inventoryMs;
  return t('inventorySaving',{normal:seconds(fast.normalInventoryMs,t),current:seconds(fast.inventoryMs,t),difference:seconds(Math.abs(difference),t),direction:t(difference>=0?'shorter':'longer')});
}

// These are observed medians on this device, not a counterfactual for this boot.
// Never compare different plugin versions, empty/selected scopes, or failed runs.
function comparisonKey(run:StartupRun):string|null {
  const c=record(run.configuration),s=record(c.scope),startup=record(c.startup),counts=run.uiReadyState??run.counts;
  if(!c||c.settingsLoaded!==true||!s||typeof s.all!=='boolean'||!finite(s.folderCount)||!startup||!finite(counts?.files)||!finite(counts?.tabs))return null;
  if(!s.all&&s.folderCount>0&&typeof s.identity!=='string')return null;
  const environment=Object.entries(run.environment).sort(([a],[b])=>a.localeCompare(b));
  const plugins=Object.entries(run.plugins).map(([id,p])=>[id,p?.version??'']).sort(([a],[b])=>a.localeCompare(b));
  return JSON.stringify([environment,plugins,counts.files,counts.tabs,c.fastMode,[s.all,s.folderCount,s.all||s.folderCount===0?'':s.identity],
    [startup.workspace!==false,startup.pluginFiles!==false,startup.fastTabs===true]]);
}
function usable(run:StartupRun):boolean {
  const ui=run.uiReadyState;
  const observed=ui?ui.hidden===false&&ui.interacted===false:run.status==='complete'&&run.interaction.hidden===false&&(run.interaction.firstMs===null||(finite(run.interaction.firstMs)&&run.interaction.firstMs>run.milestones.uiReadyMs!));
  return run.kind==='startup'&&observed&&finite(run.milestones.uiReadyMs)&&run.milestones.uiReadyMs>0&&
    !['failed','unavailable'].includes(String(run.fastStart?.phase))&&!Object.values(run.phases).some(spans=>!Array.isArray(spans)||spans.some(p=>!p||p.ok!==true))&&
    !Object.values(run.plugins).some(p=>!p||!Array.isArray(p.loads)||p.loads.some(span=>!span||span.ok!==true));
}
export interface StartupComparison {normalMs:number;optimizedMs:number;savedMs:number;percent:number;normalCount:number;optimizedCount:number;variable:boolean;}
export function compareStartups(history:StartupRun[],anchor?:StartupRun):StartupComparison|null {
  const reference=anchor??history[history.length-1];if(!reference)return null;
  const key=comparisonKey(reference);if(!key)return null;
  const matching=history.filter(run=>usable(run)&&comparisonKey(run)===key);
  const values=(mode:string)=>matching.filter(run=>run.condition.mode===mode).map(run=>run.milestones.uiReadyMs!).sort((a,b)=>a-b);
  const normal=values('measurement-only'),optimized=values('optimized');if(!normal.length||!optimized.length)return null;
  const median=(a:number[])=>a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;
  const normalMs=median(normal),optimizedMs=median(optimized),savedMs=normalMs-optimizedMs;
  const variable=(a:number[])=>a[a.length-1]-a[0]>Math.max(1000,median(a)*.3);
  return {normalMs,optimizedMs,savedMs,percent:savedMs/normalMs*100,normalCount:normal.length,optimizedCount:optimized.length,variable:variable(normal)||variable(optimized)};
}
export function comparisonText(comparison:StartupComparison|null,t:Translator=japanese):string {
  if(!comparison)return '';
  const c=comparison;
  return t('comparison',{normal:seconds(c.normalMs,t),optimized:seconds(c.optimizedMs,t),saved:seconds(Math.abs(c.savedMs),t),percent:Math.abs(c.percent).toFixed(0),direction:t(c.savedMs>=0?'shorter':'longer'),normalCount:c.normalCount,optimizedCount:c.optimizedCount,variable:c.variable?t('variable'):''});
}
