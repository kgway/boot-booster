import { App, TFile } from 'obsidian';
import {record,isMethod} from './runtime';
import {patchMethods} from './method-patch';
export function templaterOwner(app:unknown):unknown{return record(record(record(record(record(app).plugins).plugins)['templater-obsidian']).templater).constructor;}
/** Discovering an existing disk file is not a user-created empty note. */
export function protectDiscoveredNotes(app:App,recognizing:(path:string)=>boolean):{owner:unknown;dispose:()=>void}|null {
  const owner=templaterOwner(app),original=record(owner).on_file_creation;if(!isMethod(original))return null;
  const wrapped=function(this:unknown,...args:unknown[]){if(args[2] instanceof TFile&&recognizing(args[2].path))return Promise.resolve();return original.apply(this,args);};
  const dispose=patchMethods([{host:owner,name:'on_file_creation',replacement:wrapped}]);
  // Stop before recognizing cached files if a present integration cannot be protected.
  if(!dispose)throw Error('Existing-file discovery protection unavailable');
  return {owner,dispose};
}
