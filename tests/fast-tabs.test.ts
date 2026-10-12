import {test} from 'node:test';import assert from 'node:assert/strict';
import {fastTabs} from '../src/fast-tabs';
function fixture(){
 const calls:any[]=[],classes=new Set<string>();let enabled=true,finish!:()=>void;
 const pending=new Promise<void>(r=>finish=r),workspace={getMostRecentLeaf:()=>({id:'one'})};
 const bridge={nativePromise(...args:any[]){calls.push(args);return pending;}};
 const switcher={containerEl:{classList:{toggle:(n:string,v:boolean)=>v?classes.add(n):classes.delete(n),remove:(n:string)=>classes.delete(n)}},
   async show(){/* takeScreenshot */await Promise.resolve();await bridge.nativePromise('App','takeScreenshot',{path:'app/tab-preview/leaf-one.png'});return 'native-ui';}};
 const original=bridge.nativePromise,show=switcher.show;
 const dispose=fastTabs(switcher,bridge,workspace,'app','1.14.4',()=>enabled);
 return {calls,classes,bridge,switcher,dispose,original,show,finish,disable:()=>enabled=false};
}
test('fast tabs skips only the active native tab preview and preserves native completion and controls',async()=>{
 const f=fixture();try{assert.equal(await f.switcher.show(),'native-ui');assert.equal(f.calls.length,0);assert.ok(f.classes.has('boot-booster-fast-tabs'));
 const p=f.bridge.nativePromise('App','takeScreenshot',{path:'app/tab-preview/leaf-one.png'});assert.equal(p instanceof Promise,true);assert.equal(f.calls.length,1);f.finish();await p;}finally{f.dispose();}
 assert.equal(f.bridge.nativePromise,f.original);assert.equal(f.switcher.show,f.show);assert.equal(f.classes.size,0);
});
test('disabled fast tabs and other native operations retain the original promises',async()=>{
 const f=fixture();f.disable();const show=f.switcher.show();await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);f.finish();assert.equal(await show,'native-ui');assert.equal(f.classes.size,0);
 const other=f.bridge.nativePromise('Filesystem','readFile',{path:'note.md'});assert.deepEqual(f.calls[1],['Filesystem','readFile',{path:'note.md'}]);await other;f.dispose();
});
test('unload during the native show and later wrappers retire the screenshot bypass',async()=>{
 const f=fixture(),native=f.bridge.nativePromise,show=f.switcher.show;f.bridge.nativePromise=(...a:any[])=>native.apply(f.bridge,a as any);f.switcher.show=()=>show.call(f.switcher);
 const pending=f.switcher.show();f.dispose();await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);f.finish();await pending;assert.equal(f.classes.size,0);
});
test('unknown host contracts install no hooks',()=>{
 const bridge={nativePromise(){return Promise.resolve();}},switcher={show(){return Promise.resolve();}};const a=bridge.nativePromise,b=switcher.show;
 fastTabs(switcher,bridge,{},'app','1.14.5',()=>true)();assert.equal(bridge.nativePromise,a);assert.equal(switcher.show,b);
});
test('lightweight native rendering uses inline images and restores the cache path and normal previews',()=>{
 let enabled=true;const image:any={src:'',getAttribute(){return this.src;}};
 const switcher:any={cacheDir:'cache/',tabPreviews:{},show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */image.src=this.cacheDir+'leaf-one.png?time';this.tabPreviews={one:{previewImgEl:image,leaf:{id:'one'},togglePlaceholder(){}}};return 'native-render';}};
 const original=switcher.render,bridge={nativePromise(){return Promise.resolve();}},dispose=fastTabs(switcher,bridge,{getMostRecentLeaf(){}},'app','1.14.4',()=>enabled);
 assert.equal(switcher.render(),'native-render');assert.equal(switcher.cacheDir,'cache/');assert.ok(image.src.startsWith('data:image/gif;'));
 enabled=false;switcher.render();assert.equal(image.src,'cache/leaf-one.png?time');enabled=true;switcher.render();dispose();assert.equal(switcher.render,original);assert.ok(image.src.startsWith('cache/leaf-one.png?'));
});

test('inline preview load keeps native icon display and restores normal image handling on disable and unload',()=>{
 let enabled=true;const image:any={src:'',style:{display:''},getAttribute(){return this.src;}};
 const prototype={togglePlaceholder(this:any,visible:boolean){this.placeholderEl.style.display=visible?'':'none';this.previewImgEl.style.display=visible?'none':'';return visible;}};
 const preview:any=Object.assign(Object.create(prototype),{previewImgEl:image,placeholderEl:{style:{display:'none'}},leaf:{id:'one'}});
 const switcher:any={cacheDir:'cache/',tabPreviews:{one:preview},show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */image.src=this.cacheDir+'leaf-one.png?time';}};
 const dispose=fastTabs(switcher,{nativePromise(){return Promise.resolve();}},{getMostRecentLeaf(){}},'app','1.14.4',()=>enabled);
 switcher.render();assert.equal(preview.placeholderEl.style.display,'');assert.equal(image.style.display,'none');
 // The native GIF load handler normally requests the screenshot, not the icon.
 assert.equal(preview.togglePlaceholder(false),true);assert.equal(preview.placeholderEl.style.display,'');assert.equal(image.style.display,'none');
 enabled=false;assert.equal(preview.togglePlaceholder(false),false);assert.equal(preview.placeholderEl.style.display,'none');assert.equal(image.style.display,'');
 enabled=true;switcher.render();const wrapper=preview.togglePlaceholder;
 preview.togglePlaceholder=(value:boolean)=>wrapper.call(preview,value);dispose();
 assert.ok(image.src.startsWith('cache/leaf-one.png?'));assert.equal(preview.togglePlaceholder(false),false);
});

test('closed previews retire inherited hooks and locked preview methods fall back to native images',()=>{
 const prototype={togglePlaceholder(visible:boolean){return visible;}},image=()=>({src:'',getAttribute(){return this.src;}});
 const first:any=Object.assign(Object.create(prototype),{previewImgEl:image(),leaf:{id:'one'}});
 const locked:any={previewImgEl:image(),leaf:{id:'two'}};Object.defineProperty(locked,'togglePlaceholder',{value:prototype.togglePlaceholder,writable:false});
 const switcher:any={cacheDir:'cache/',tabPreviews:{one:first},show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */for(const p of Object.values(this.tabPreviews) as any[])p.previewImgEl.src=this.cacheDir+'leaf-'+p.leaf.id+'.png?time';}};
 const dispose=fastTabs(switcher,{nativePromise(){return Promise.resolve();}},{getMostRecentLeaf(){}},'app','1.14.4',()=>true);
 switcher.render();const wrapper=first.togglePlaceholder;switcher.tabPreviews={two:locked};switcher.render();
 assert.equal(Object.prototype.hasOwnProperty.call(first,'togglePlaceholder'),false);assert.equal(wrapper.call(first,false),false);
 assert.ok(locked.previewImgEl.src.startsWith('cache/leaf-two.png?'));dispose();
});

test('previews created before fast tab rendering also use native placeholders',()=>{
 const image={src:'cache/leaf-one.png',getAttribute(){return this.src;}},preview={previewImgEl:image,leaf:{id:'one'},visible:false,togglePlaceholder(visible:boolean){this.visible=visible;}};
 const switcher={cacheDir:'cache/',tabPreviews:{one:preview},show(){/* takeScreenshot */return Promise.resolve();},render(){return Object.keys(this.tabPreviews);}};
 const dispose=fastTabs(switcher,{nativePromise(){return Promise.resolve();}},{getMostRecentLeaf(){}},'app','1.14.4',()=>true);
 switcher.render();assert.ok(image.src.startsWith('data:image/gif;'));preview.togglePlaceholder(false);assert.equal(preview.visible,true);
 dispose();assert.ok(image.src.startsWith('cache/leaf-one.png?'));preview.togglePlaceholder(false);assert.equal(preview.visible,false);
});
test('show retains native promise identity and propagates native UI rejection',async()=>{
 const error=Error('native UI'),promise=Promise.reject(error),switcher={show(){/* takeScreenshot */return promise;}},bridge={nativePromise(){return Promise.resolve();}};
 const dispose=fastTabs(switcher,bridge,{getMostRecentLeaf:()=>({id:'one'})},'app','1.14.4',()=>true);
 assert.equal(switcher.show(),promise);await assert.rejects(promise,e=>e===error);dispose();
});
test('a failing native renderer cannot leave an inline cache path behind',()=>{
 const error=Error('render'),switcher:any={cacheDir:'cache/',tabPreviews:{},show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */throw error;}};
 const dispose=fastTabs(switcher,{nativePromise(){return Promise.resolve();}},{getMostRecentLeaf(){}},'app','1.14.4',()=>true);
 assert.throws(()=>switcher.render(),e=>e===error);assert.equal(switcher.cacheDir,'cache/');dispose();
});

test('an unavailable tab hook rolls back the native bridge without interrupting startup',()=>{
 for(const locked of ['show','render']){
  const switcher:any={show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */}};
  Object.defineProperty(switcher,locked,{writable:false});
  const bridge={nativePromise(){return Promise.resolve();}},native=bridge.nativePromise,show=switcher.show,render=switcher.render;
  assert.doesNotThrow(()=>fastTabs(switcher,bridge,{getMostRecentLeaf(){}},'app','1.14.4',()=>true)());
  assert.equal(bridge.nativePromise,native);assert.equal(switcher.show,show);assert.equal(switcher.render,render);
 }
});

test('tab hook cleanup restores inherited methods instead of leaving instance shadows',()=>{
 const prototype={show(){/* takeScreenshot */return Promise.resolve();},render(){/* tabPreviews */}},switcher=Object.create(prototype);
 const bridge=Object.create({nativePromise(){return Promise.resolve();}});
 fastTabs(switcher,bridge,{getMostRecentLeaf(){}},'app','1.14.4',()=>true)();
 assert.equal(Object.prototype.hasOwnProperty.call(switcher,'show'),false);assert.equal(Object.prototype.hasOwnProperty.call(switcher,'render'),false);assert.equal(Object.prototype.hasOwnProperty.call(bridge,'nativePromise'),false);
});
