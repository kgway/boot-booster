import { Scope, normalizeScope } from './target';
import {record} from './runtime';
export interface StartupSettings {workspace:boolean;fastTabs?:boolean;pluginFiles?:boolean;}
export interface Settings { version: 2; scope: Scope; startup:StartupSettings; }
export const startupDefaults=():StartupSettings=>({workspace:true});
export const defaults = ():Settings => ({version:2,scope:{all:true,folders:[]},startup:startupDefaults()});
export function parseSettings(raw: unknown, configDir=''): Settings {
  if(!raw||typeof raw!=='object') return defaults();
  const data=record(raw),savedStartup=record(data.startup),scope=record(data.scope);
  const startup:StartupSettings={workspace:savedStartup.workspace!==false};
  if(typeof savedStartup.fastTabs==='boolean')startup.fastTabs=savedStartup.fastTabs;
  if(typeof savedStartup.pluginFiles==='boolean')startup.pluginFiles=savedStartup.pluginFiles;
  if(data.version===2&&typeof scope.all==='boolean'&&Array.isArray(scope.folders))
    return {version:2,scope:{all:scope.all,folders:normalizeScope({all:false,folders:scope.folders.filter((p:unknown):p is string=>typeof p==='string')},configDir).folders},startup};
  if(typeof data.targetFolder==='string') return {version:2,scope:normalizeScope({all:false,folders:[data.targetFolder]},configDir),startup};
  return {...defaults(),startup};
}
