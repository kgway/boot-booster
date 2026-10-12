import type {Store} from './benchmark';
import ja from './locales/ja.json';
import en from './locales/en.json';
export type Language='ja'|'en';
export type LanguageChoice=Language;
export type MessageKey=keyof typeof ja;
export type Translator=(key:MessageKey,values?:Record<string,string|number>)=>string;
const catalogs:Record<Language,Record<MessageKey,string>>={ja,en};
export const resolveLanguage=(appLanguage:string,choice?:Language):Language=>choice??(/^ja(?:[-_]|$)/i.test(appLanguage)?'ja':'en');
export const translate=(language:Language):Translator=>(key,values={})=>catalogs[language][key].replace(/\{(\w+)\}/g,(match:string,name:string)=>String(values[name]??match));
export const japanese=translate('ja');
/** Device-local language preference; an unset or legacy auto choice uses the app language. */
export class Localizer {
 choice:Language;readonly key:string;
 constructor(appLanguage:string,private storage?:Pick<Store,'getItem'|'setItem'>,root=''){
  this.choice=resolveLanguage(appLanguage);this.key=`boot-booster:language:v1:${root}`;
  try{const saved=storage?.getItem(this.key);if(saved==='ja'||saved==='en')this.choice=saved;}catch{/* Use the app language when storage is unavailable. */}
 }
 get language():Language{return this.choice;}
 readonly text:Translator=(key,values)=>translate(this.language)(key,values);
 set(choice:Language):void{if(!this.storage)throw Error('Language storage unavailable');this.storage.setItem(this.key,choice);this.choice=choice;}
}
