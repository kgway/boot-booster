import {IdleScheduler} from './scheduler';
import {patchMethods} from './method-patch';
import {isMethod,isThenable,record} from './runtime';

/** Keep native asynchronous UI work in front of the background scanner.
 * Return the original result, including its Promise identity and rejection. */
export function protectForeground(host:unknown,name:string,scheduler:IdleScheduler,active:()=>boolean,options:{coalesce?:boolean}={}):()=>void{
  const original=record(host)[name];
  if(!isMethod(original))return ()=>{};
  let enabled=true;const pending=new Map<unknown,unknown>();
  const wrapped=function(this:unknown,...args:unknown[]){
    if(!enabled)return original.apply(this,args);
    if(options.coalesce&&pending.has(this))return pending.get(this);
    if(!active())return original.apply(this,args);
    const release=scheduler.beginForeground();
    try{const result=original.apply(this,args);
      if(isThenable(result)){
        // Native tab overview starts a screenshot and pushes navigation state
        // before its promise settles. Repeated taps should share that opening.
        if(options.coalesce)pending.set(this,result);
        const finish=()=>{if(pending.get(this)===result)pending.delete(this);release();};
        void Promise.resolve(result).then(finish,finish);
      }else release();
      return result;
    }catch(error){release();throw error;}
  };
  const undo=patchMethods([{host,name,replacement:wrapped}]);
  return ()=>{enabled=false;pending.clear();undo?.();};
}
