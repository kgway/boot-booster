export const coreViews=new Set(['empty','markdown','canvas','pdf','image','audio','video','file-explorer','search','bookmarks','outline','backlink','outgoing-link','tag','all-properties','file-properties','graph','localgraph','release-notes']);
const fileIcons:Record<string,string>={markdown:'lucide-file',canvas:'lucide-layout-dashboard',pdf:'lucide-file-text',image:'lucide-image',audio:'lucide-music',video:'lucide-video'};
export interface ViewLabel {icon:string;title:string;}
import {record,isRecord} from './runtime';
export function labelKey(value:unknown):string{const view=record(value),state=record(view.state);return JSON.stringify([view.type,typeof state.file==='string'?state.file:'']);}
export function viewTypes(layout:unknown):Set<string>{
  const types=new Set<string>();const visit=(value:unknown)=>{const node=record(value),state=record(node.state);if(node.type==='leaf'&&typeof state.type==='string')types.add(state.type);if(Array.isArray(node.children))node.children.forEach(visit);};
  for(const key of ['main','left','right','floating'])visit(record(layout)[key]);return types;
}
/** Add display hints to a copy. Native DeferredView retains the original state,
 * IDs, pins, groups, selection, and opens visible views itself. */
export function deferWorkspace<T>(layout:T,labels:Record<string,ViewLabel>,registered:(type:string)=>boolean):{layout:T;hinted:number}{
  let hinted=0;
  const root=record(layout);
  const visit=(node:unknown,visible:boolean):unknown=>{
    if(!isRecord(node))return node;
    const copy={...node};if(Array.isArray(node.children))copy.children=node.children.map((child:unknown,i:number)=>visit(child,visible&&node.collapsed!==true&&(node.type!=='tabs'||i===(Number.isInteger(node.currentTab)?node.currentTab:0))));
    const v=record(node.state),state=record(v.state);
    if(node.type==='leaf'&&!visible&&!(typeof node.id==='string'&&node.id===root.active)&&typeof v.type==='string'&&registered(v.type)){
      let label=labels[labelKey(v)];
      if(!label&&fileIcons[v.type]&&typeof state.file==='string'){const title=state.file.split('/').pop()!.replace(/\.[^.]+$/,'');label={icon:fileIcons[v.type],title};}
      if(label&&(!v.icon||typeof v.title!=='string')){copy.state={...v,icon:v.icon||label.icon,title:typeof v.title==='string'?v.title:label.title};hinted++;}
    }return copy;
  };
  if(!isRecord(layout))return {layout,hinted};
  const copy={...root};for(const key of ['main','left','right','floating'])if(root[key])copy[key]=visit(root[key],true);
  // Only display hints are added; callers retain the original workspace shape.
  return {layout:copy as T,hinted};
}
