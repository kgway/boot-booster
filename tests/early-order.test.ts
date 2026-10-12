import {test} from 'node:test';import assert from 'node:assert/strict';
import {promoteBooster} from '../src/early-order';
test('only Boot Booster moves first; other plugin order and Set identity stay intact',async()=>{
 const set=new Set(['one','two','boot-booster','three']),calls:any[]=[];
 const m={enabledPlugins:set,async saveConfig(){calls.push([...this.enabledPlugins]);}};
 assert.equal(await promoteBooster(m,'boot-booster',()=>false),'saved');assert.equal(m.enabledPlugins,set);
 assert.deepEqual([...set],['boot-booster','one','two','three']);assert.deepEqual(calls,[['boot-booster','one','two','three']]);
 assert.equal(await promoteBooster(m,'boot-booster',()=>false),'unchanged');assert.equal(calls.length,1);
});
test('disabled, unloaded and unsupported managers never cause plugin enablement or config writes',async()=>{
 const m={enabledPlugins:new Set(['one']),saveConfig(){throw Error('must not save');}};
 assert.equal(await promoteBooster(m,'boot-booster',()=>false),'unsupported');m.enabledPlugins.add('boot-booster');
 assert.equal(await promoteBooster(m,'boot-booster',()=>true),'unsupported');assert.equal(await promoteBooster({},'boot-booster',()=>false),'unsupported');
});
test('failed save rolls back only if the enabled set has not changed concurrently',async()=>{
 const m={enabledPlugins:new Set(['one','boot-booster']),async saveConfig(){throw Error('denied');}};
 assert.equal(await promoteBooster(m,'boot-booster',()=>false),'failed');assert.deepEqual([...m.enabledPlugins],['one','boot-booster']);
 m.saveConfig=async()=>{m.enabledPlugins.delete('boot-booster');m.enabledPlugins.add('new');throw Error('denied');};
 assert.equal(await promoteBooster(m,'boot-booster',()=>false),'failed');assert.deepEqual([...m.enabledPlugins],['one','new']);
});
