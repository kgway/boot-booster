import {IdleScheduler} from './scheduler';
import {supportsAndroidAdapter} from './compatibility';
import {record,isMethod,UnknownRecord,HostMethod} from './runtime';

/** Match the native DeferredView branch only for a new, hidden startup leaf.
 * Native restoration stores its state without reading the file. The eventual
 * rerender is not an empty leaf and must still pass foreground verification. */
export function defersInitialView(value:unknown,rawState:unknown,api:string):boolean {
  const leaf=record(value),state=record(rawState),app=record(leaf.app),container=record(leaf.containerEl),registry=record(app.viewRegistry);
  if(!supportsAndroidAdapter(api)||record(app.workspace).layoutReady!==false||!leaf._empty||leaf.view!==leaf._empty||
    state.type==='empty'||typeof state.type!=='string'||!state.icon||typeof state.title!=='string'||
    !isMethod(container.isShown)||!isMethod(registry.getViewCreatorByType))return false;
  try{return !container.isShown()&&!!registry.getViewCreatorByType(state.type);}catch{return false;}
}

/** Prevent automatic rerenders from overtaking a file check. Explicit active
 * opens wait for our in-flight request instead of being discarded as busy. */
export function guardViewState(original:(...args:never[])=>unknown,port:{owns(leaf:UnknownRecord):boolean;scanning():boolean;deferOnly?(leaf:UnknownRecord,state:UnknownRecord):boolean;ensure(path:string):Promise<void>;scheduler:IdleScheduler}) {
  const preparing=new WeakMap<object,Promise<unknown>>();
  const wrapped=function(this:object,rawState:unknown,...args:unknown[]):Promise<unknown>{
    const state=record(rawState),leaf=record(this);
    // Native setViewState returns a promise. Keep it verbatim in bypass paths.
    const invoke=()=>(original as HostMethod).apply(this,[rawState,...args]) as Promise<unknown>;
    if(!port.owns(leaf))return invoke();
    const pending=preparing.get(this);
    if(pending){
      // Native DeferredView.rerender omits active. It must not restore an old
      // file over a newer open. openFile's active requests retain their turn.
      if(state.active!==true)return Promise.resolve();
      const retry=()=>wrapped.call(this,rawState,...args);
      return pending.then(retry,retry);
    }
    if(!port.scanning()||leaf.working)return invoke();
    if(port.deferOnly?.(leaf,state))return invoke();
    const file=record(state.state).file,path=typeof file==='string'?file:undefined;
    const release=port.scheduler.beginForeground(path);
    if(!path){
      try{
        const result=invoke(),task=Promise.resolve(result);preparing.set(this,task);
        const finish=()=>{preparing.delete(this);release();};
        void task.then(finish,finish);return result;
      }
      catch(error){release();throw error;}
    }
    const task=Promise.resolve().then(()=>port.ensure(path)).then(invoke)
      .finally(()=>{preparing.delete(this);release();});
    preparing.set(this,task);return task;
  };
  return wrapped;
}
