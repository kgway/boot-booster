import {test} from 'node:test';import assert from 'node:assert/strict';
import {deferWorkspace,labelKey,viewTypes} from '../src/workspace-startup';
const leaf=(id:string)=>({id,type:'leaf',group:'g1',pinned:true,state:{type:'markdown',state:{file:`資料/${id}.md`,mode:'source',source:false}}});
test('visible and saved active tabs keep native restoration; hidden tabs retain full state',()=>{
 const layout={main:{id:'m',type:'split',children:[{id:'t',type:'tabs',currentTab:1,children:[leaf('hidden'),leaf('selected'),leaf('active')]}]},active:'active',lastOpenFiles:['資料/active.md']},before=JSON.stringify(layout);
 const result=deferWorkspace(layout,{},()=>true),children=result.layout.main.children[0].children;
 assert.equal(result.hinted,1);assert.equal(JSON.stringify(layout),before);assert.deepEqual(children[1],layout.main.children[0].children[1]);assert.deepEqual(children[2],layout.main.children[0].children[2]);
 assert.deepEqual(children[0],{...leaf('hidden'),state:{...leaf('hidden').state,icon:'lucide-file',title:'hidden'}});assert.equal(result.layout.active,'active');assert.equal(result.layout.main.children[0].currentTab,1);
});
test('unknown views are untouched and custom hints apply only to hidden tabs',()=>{
 const state={type:'custom',state:{opaque:{a:1}}},layout={right:{type:'tabs',collapsed:true,children:[{type:'leaf',state}]}};
 const labels={[labelKey(state)]:{title:'Custom tab',icon:'lucide-star'}};assert.equal(deferWorkspace(layout,labels,()=>false).hinted,0);
 const result=deferWorkspace(layout,labels,()=>true);assert.equal(result.hinted,1);assert.deepEqual(result.layout.right.children[0].state.state,state.state);assert.deepEqual([...viewTypes(layout)],['custom']);
});
test('each visible split and floating tab is protected and existing labels survive',()=>{
 const tabs=(id:string)=>({type:'tabs',children:[leaf(id),leaf(id+'hidden')]}),layout={main:{type:'split',children:[tabs('a'),tabs('b')]},floating:{type:'split',children:[tabs('c')]},left:{type:'tabs',collapsed:true,children:[leaf('left')]}};
 const result=deferWorkspace(layout,{},()=>true);assert.equal(result.hinted,4);for(let i=0;i<2;i++)assert.deepEqual(result.layout.main.children[i].children[0],layout.main.children[i].children[0]);
 assert.deepEqual(result.layout.floating.children[0].children[0],layout.floating.children[0].children[0]);
 const labeled={...leaf('x'),state:{...leaf('x').state,title:'Saved',icon:'saved-icon'}};
 assert.deepEqual(deferWorkspace({main:{type:'tabs',children:[labeled]}},{},()=>true).layout.main.children[0],labeled);
});
