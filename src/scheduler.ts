/** Only background tasks wait here. Foreground I/O never waits for idle. */
export class IdleScheduler {
  private quietUntil=0;
  private lastActivity=-Infinity;
  private stopped=false;
  private held=0;
  private draining=false;
  private interactive:string|null=null;
  private foreground=new Map<string,{count:number;token:object}>();
  private yieldedAt=-Infinity;
  waits=0;
  readonly timing={waitMs:0,hiddenMs:0,foregroundMs:0,quietMs:0,yieldMs:0,yields:0};
  constructor(private visible=()=>typeof document==='undefined'||document.visibilityState==='visible', private now=()=>performance.now(), private sleep=(ms:number)=>new Promise<void>(r=>window.setTimeout(r,ms))) {}
  activity(ms=1200):void {this.lastActivity=this.now();this.quietUntil=Math.max(this.quietUntil,this.lastActivity+ms);}
  setHeld(held:boolean):void {this.held=Math.max(0,this.held+(held?1:-1));if(!held)this.activity();}
  prioritize(path:string):void {this.interactive=path;this.activity();}
  isPriority(path:string):boolean {return this.interactive===path||this.foreground.has(path);}
  foregroundToken(path:string):object|undefined {return this.foreground.get(path)?.token;}
  hasForeground():boolean {return this.held>0;}
  get waitingFor():'none'|'hidden'|'foreground'|'input'|'stopped' {
    if(this.stopped)return 'stopped';if(this.draining)return 'none';
    return !this.visible()?'hidden':this.held?'foreground':this.now()<this.quietUntil?'input':'none';
  }
  beginForeground(path?:string):()=>void {
    if(path)this.prioritize(path);this.setHeld(true);if(path){const operation=this.foreground.get(path);if(operation)operation.count++;else this.foreground.set(path,{count:1,token:{}});}
    let ended=false;
    return ()=>{if(ended)return;ended=true;if(path){const operation=this.foreground.get(path);if(operation&&--operation.count===0)this.foreground.delete(path);}this.setHeld(false);};
  }
  async idle(minQuietMs=0):Promise<void> {
    const quietUntil=()=>Math.max(this.quietUntil,this.lastActivity+minQuietMs);
    while(!this.stopped&&!this.draining&&(!this.visible()||this.held||this.now()<quietUntil())) {
      const reason=!this.visible()?'hiddenMs':this.held?'foregroundMs':'quietMs',start=this.now();
      this.waits++;await this.sleep(80);const elapsed=Math.max(0,this.now()-start);this.timing.waitMs+=elapsed;this.timing[reason]+=elapsed;
    }
    if(this.stopped)throw new Error('Background scan stopped');
    const start=this.now();
    await this.sleep(12);
    this.timing.yieldMs+=Math.max(0,this.now()-start);this.timing.yields++;this.yieldedAt=this.now();
    if(this.stopped)throw new Error('Background scan stopped');
    // Input can arrive during the yield.
    if(!this.draining&&(!this.visible()||this.held||this.now()<quietUntil()))return this.idle(minQuietMs);
  }
  /** Small scan batches share a 4 ms budget, rather than sleeping per folder/batch.
   * Check every boundary so input/foreground holds always take precedence. */
  async checkpoint():Promise<void> {
    if(this.stopped)throw new Error('Background scan stopped');
    if((!this.draining&&(!this.visible()||this.held||this.now()<this.quietUntil))||this.now()-this.yieldedAt>=4)await this.idle();
  }
  drain():void {this.draining=true;}
  stop():void {this.stopped=true;}
}
