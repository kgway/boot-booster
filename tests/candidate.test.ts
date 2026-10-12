import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
// The helper is build tooling; it never enters the Android bundle.
const {createZip,crc32,checkRuntime}=require('../../docs/candidate-core.cjs');
const manifest={id:'boot-booster',version:'1.10.1'},pkg={version:'1.10.1'};
const runtime={'main.js':Buffer.from('source'), 'manifest.json':Buffer.from(JSON.stringify(manifest)), 'styles.css':Buffer.from('')};
const meta={inputs:{'src/main.ts':{}},outputs:{'main.js':{imports:[{path:'obsidian',external:true}]}}};

test('candidate ZIP round-trips all four allowed files with fixed headers and CRCs',()=>{
 const files=Object.fromEntries([...Object.entries(runtime),['INSTALL.md',Buffer.from('導入😀')]].map(([name,bytes])=>['boot-booster/'+name,bytes]));
 const zipped=createZip(files),entries:Record<string,Buffer>={};let at=0;
 while(zipped.readUInt32LE(at)===0x04034b50){
  assert.equal(zipped.readUInt16LE(at+6),0x800);assert.equal(zipped.readUInt16LE(at+10),0);assert.equal(zipped.readUInt16LE(at+12),0x21);
  const size=zipped.readUInt32LE(at+18),length=zipped.readUInt16LE(at+26),extra=zipped.readUInt16LE(at+28);
  const name=zipped.subarray(at+30,at+30+length).toString('utf8'),start=at+30+length+extra;
  const decoded=inflateRawSync(zipped.subarray(start,start+size));assert.equal(crc32(decoded),zipped.readUInt32LE(at+14));
  entries[name]=decoded;at=start+size;
 }
 assert.deepEqual(entries,files);assert.equal(zipped.readUInt32LE(at),0x02014b50);
 const end=zipped.length-22;assert.equal(zipped.readUInt32LE(end),0x06054b50);assert.equal(zipped.readUInt32LE(end+16),at);assert.equal(zipped.readUInt16LE(end+10),4);
 assert.deepEqual(createZip(Object.fromEntries(Object.entries(files).reverse())),zipped);
});

test('candidate packaging refuses private logs, traversal and missing entries',()=>{
 const entries=Object.fromEntries([...Object.entries(runtime),['INSTALL.md',Buffer.from('guide')]].map(([name,bytes])=>['boot-booster/'+name,bytes]));
 for(const name of ['boot-booster/data.json','boot-booster/../secret','boot-booster/docs/validation-results.json'])assert.throws(()=>createZip({...entries,[name]:Buffer.from('private')}),/Unexpected/);
 delete entries['boot-booster/styles.css'];assert.throws(()=>createZip(entries),/Missing/);
});

test('candidate checks reject mismatched versions, personal paths and bundled development dependencies',()=>{
 assert.doesNotThrow(()=>checkRuntime(runtime,manifest,pkg,meta));
 assert.throws(()=>checkRuntime(runtime,manifest,{version:'old'},meta),/mismatch/);
 assert.throws(()=>checkRuntime({...runtime,'main.js':Buffer.from('C:\\Users\\example\\private')},manifest,pkg,meta),/Personal path/);
 assert.throws(()=>checkRuntime(runtime,manifest,pkg,{...meta,inputs:{'node_modules/something/index.js':{}}}),/bundle inputs/);
 assert.throws(()=>checkRuntime(runtime,manifest,pkg,{...meta,outputs:{'main.js':{imports:[{path:'node:fs',external:true}]}}}),/runtime import/);
});
