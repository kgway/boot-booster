// These releases share the Android adapter contract inspected in the official APKs.
// Unknown releases require device-local consent and the normal runtime guards.
const androidAdapterVersions = new Set(['1.13.8', '1.14.4', '1.15.0']);
const version=(api:unknown):api is string=>typeof api==='string'&&/^\d+\.\d+\.\d+$/.test(api);
export const verifiedAndroidVersion = (api:string):boolean => androidAdapterVersions.has(api);
export const supportsAndroidAdapter = (api:string,allowUnverified=false):boolean => verifiedAndroidVersion(api)||(allowUnverified&&version(api));
export const compatibleInventory = (cachedApi:string, api:string,allowUnverified=false):boolean =>
  version(cachedApi)&&version(api)&&(cachedApi===api || (supportsAndroidAdapter(cachedApi,allowUnverified)&&supportsAndroidAdapter(api,allowUnverified)));

interface Preferences {automatic:boolean;acceptedApi:string;promptedApi:string;}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;}
/** Consent belongs to this device; syncing plugin settings must not opt in another device. */
export class CompatibilityControl {
  readonly key:string;private preferences:Preferences={automatic:false,acceptedApi:'',promptedApi:''};
  constructor(readonly api:string,private storage?:Storage,root=''){
    this.key=`boot-booster:compatibility:v1:${root}`;
    try{const raw:unknown=JSON.parse(storage?.getItem(this.key)||'null');if(raw&&typeof raw==='object'){
      const p=raw as Record<string,unknown>;this.preferences={automatic:p.automatic===true,acceptedApi:version(p.acceptedApi)?p.acceptedApi:'',promptedApi:version(p.promptedApi)?p.promptedApi:''};
    }}catch{/* Missing or invalid consent uses the default version gate. */}
  }
  get automatic():boolean{return this.preferences.automatic;}
  get allowed():boolean{return supportsAndroidAdapter(this.api,this.preferences.automatic||this.preferences.acceptedApi===this.api);}
  get policy():'verified'|'automatic'|'accepted'|'blocked'{return verifiedAndroidVersion(this.api)?'verified':this.allowed?(this.automatic?'automatic':'accepted'):'blocked';}
  shouldPrompt(android:boolean,optimizing:boolean):boolean{return android&&optimizing&&version(this.api)&&!this.allowed&&this.preferences.promptedApi!==this.api;}
  private save(change:Partial<Preferences>):void{if(!this.storage)throw Error('Consent storage unavailable');const next={...this.preferences,...change};this.storage.setItem(this.key,JSON.stringify(next));this.preferences=next;}
  setAutomatic(automatic:boolean):void{this.save({automatic,...(!automatic?{acceptedApi:''}:{})});}
  prompted():void{this.save({promptedApi:this.api});}
  accept():void{this.save({acceptedApi:this.api,promptedApi:this.api});}
  snapshot(){return {api:this.api,verified:verifiedAndroidVersion(this.api),allowed:this.allowed,policy:this.policy};}
}
