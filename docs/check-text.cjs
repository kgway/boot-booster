const fs=require('node:fs');
const path=require('node:path');
function checkCatalogs(ja,en){
 const keys=Object.keys(ja).sort();
 if(JSON.stringify(keys)!==JSON.stringify(Object.keys(en).sort()))throw Error('Japanese/English text keys differ');
 const placeholders=text=>[...new Set(text.match(/\{\w+\}/g)??[])].sort();
 for(const key of keys){
  if(typeof ja[key]!=='string'||!ja[key].trim()||typeof en[key]!=='string'||!en[key].trim())throw Error(`Empty text: ${key}`);
  if(JSON.stringify(placeholders(ja[key]))!==JSON.stringify(placeholders(en[key])))throw Error(`Japanese/English placeholders differ: ${key}`);
 }
 return keys.length;
}
function checkFiles(root){return checkCatalogs(...['ja','en'].map(name=>JSON.parse(fs.readFileSync(path.join(root,'src/locales',name+'.json'),'utf8'))));}
module.exports={checkCatalogs,checkFiles};
if(require.main===module)console.log(`Text check passed: ${checkFiles(path.resolve(__dirname,'..'))} keys.`);
