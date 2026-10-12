import {supportsAndroidAdapter} from './compatibility';
import {patchMethods} from './method-patch';
import {record,isMethod,callMethod} from './runtime';

/** Keep native tab rendering, selection, pinning and Android back navigation.
 * Only omit the optional native screenshot; never replace file/editor reads. */
export function fastTabs(switcherValue:unknown,bridgeValue:unknown,workspaceValue:unknown,appId:string,api:string,enabled:()=>boolean,skipped:()=>void=()=>{}):()=>void {
  const switcher=record(switcherValue),bridge=record(bridgeValue),workspace=record(workspaceValue);
  const originalShow=switcher.show,originalNative=bridge.nativePromise,recentLeaf=workspace.getMostRecentLeaf;
  if(!supportsAndroidAdapter(api)||!isMethod(originalShow)||!isMethod(originalNative)||!isMethod(recentLeaf)||
    !/takeScreenshot/.test(Function.prototype.toString.call(originalShow)))return ()=>{};
  const paths=new Map<string,number>();let stopped=false;
  const native=function(this:unknown,plugin:string,method:string,options:unknown,...args:unknown[]){
    const path=record(options).path;
    if(!stopped&&enabled()&&plugin==='App'&&method==='takeScreenshot'&&typeof path==='string'&&paths.has(path)){skipped();return Promise.resolve();}
    return originalNative.apply(this,[plugin,method,options,...args]);
  };
  const originalRender=switcher.render;
  const inline='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#boot-booster-';
  const previewHooks=new Map<ReturnType<typeof record>,()=>void>();
  const restoreImage=(preview:ReturnType<typeof record>)=>{const image=record(preview.previewImgEl),src=callMethod(image,'getAttribute','src'),id=record(preview.leaf).id;
    if(typeof src==='string'&&src.startsWith(inline)&&typeof switcher.cacheDir==='string'&&typeof id==='string')image.src=`${switcher.cacheDir}leaf-${id}.png?${Date.now()}`;
  };
  const preparePreviews=()=>{
    const previews=new Set(Object.values(record(switcher.tabPreviews)).map(record));
    for(const [preview,undo] of previewHooks)if(!previews.has(preview)){undo();previewHooks.delete(preview);}
    for(const preview of previews){
      if(!previewHooks.has(preview)){
        const original=preview.togglePlaceholder;if(!isMethod(original)){restoreImage(preview);continue;}
        let retired=false;
        // Native image-load callbacks toggle inline display styles. Use that
        // same method for placeholders instead of overriding them with CSS.
        const toggle=function(this:unknown,visible:unknown,...args:unknown[]){const src=callMethod(record(record(this).previewImgEl),'getAttribute','src');
          return original.apply(this,[!retired&&!stopped&&enabled()&&typeof src==='string'&&src.startsWith(inline)?true:visible,...args]);
        };
        const undo=patchMethods([{host:preview,name:'togglePlaceholder',replacement:toggle}]);
        if(!undo){restoreImage(preview);continue;}
        previewHooks.set(preview,()=>{retired=true;undo();});
      }
      const image=record(preview.previewImgEl),id=record(preview.leaf).id;
      if(typeof id==='string'){
        const src=callMethod(image,'getAttribute','src');
        if(typeof src==='string'&&!src.startsWith(inline))image.src=`${inline}leaf-${id}.png`;
        callMethod(preview,'togglePlaceholder',true);
      }
    }
  };
  const restoreImages=()=>{for(const value of Object.values(record(switcher.tabPreviews)))restoreImage(record(value));};
  const render=isMethod(originalRender)&&/tabPreviews/.test(Function.prototype.toString.call(originalRender))?function(this:unknown,...args:unknown[]){
    if(stopped||!enabled()){restoreImages();return originalRender.apply(this,args);}
    // Native constructors append leaf-id.png to cacheDir. A one-pixel GIF with
    // a fragment is a valid local placeholder and starts no storage requests.
    // Keep the native cache path unchanged outside this synchronous render.
    const receiver=record(this),dir=receiver.cacheDir;
    let result:unknown;
    try{receiver.cacheDir=inline;result=originalRender.apply(this,args);}finally{receiver.cacheDir=dir;}
    preparePreviews();return result;
  }:undefined;
  const classes=record(record(switcher.containerEl).classList);
  const show=function(this:unknown,...args:unknown[]){
    const active=!stopped&&enabled(),leaf=record(active?recentLeaf.call(workspace):undefined);
    const path=typeof leaf.id==='string'?`${appId}/tab-preview/leaf-${leaf.id}.png`:undefined;
    if(active&&path)paths.set(path,(paths.get(path)??0)+1);
    callMethod(classes,'toggle','boot-booster-fast-tabs',active);
    const finish=()=>{if(path){const n=(paths.get(path)??1)-1;if(n)paths.set(path,n);else paths.delete(path);}};
    try{const result=originalShow.apply(this,args);void Promise.resolve(result).then(finish,finish);return result;}catch(error){finish();throw error;}
  };
  const undo=patchMethods([{host:bridge,name:'nativePromise',replacement:native},{host:switcher,name:'show',replacement:show},
    ...(render?[{host:switcher,name:'render',replacement:render}]:[])]);
  if(!undo)return ()=>{};
  return ()=>{stopped=true;paths.clear();callMethod(classes,'remove','boot-booster-fast-tabs');
    try{restoreImages();}finally{for(const dispose of previewHooks.values())dispose();previewHooks.clear();undo();}
  };
}
