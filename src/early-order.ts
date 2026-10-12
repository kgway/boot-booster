/** Only move this plugin; preserve every other plugin's relative order and Set identity.
 * Called after layout, so the native startup loop already keeps its captured order. */
import {record,isMethod} from './runtime';
export async function promoteBooster(value:unknown,id:string,stopped:()=>boolean):Promise<'unchanged'|'saved'|'unsupported'|'failed'>{
 const manager=record(value);
 const set=manager?.enabledPlugins;
 if(stopped()||typeof id!=='string'||!(set instanceof Set)||!set.has(id)||!isMethod(manager.saveConfig))return 'unsupported';
 const before:unknown[]=[...set];if(before[0]===id)return 'unchanged';
 if(before.some(x=>typeof x!=='string'))return 'unsupported';
 const next=[id,...before.filter(x=>x!==id)];
 set.clear();next.forEach(x=>set.add(x));
 try{await manager.saveConfig();return 'saved';}
 catch{
  // Never resurrect a plugin disabled while saving, or discard a new enablement.
  if(manager.enabledPlugins===set&&JSON.stringify([...set])===JSON.stringify(next)){set.clear();before.forEach(x=>set.add(x));}
  return 'failed';
 }
}
