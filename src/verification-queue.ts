/** Keep stat requests out of the native adapter's queue until their turn.
 * A foreground request can pass queued background checks without interrupting
 * the single check already running. No filesystem mutations run here. */
export class VerificationQueue {
  private jobs:{path:string;foreground:boolean;run:()=>Promise<void>;resolve:()=>void;reject:(error:unknown)=>void}[]=[];
  private running=false;
  enqueue(path:string,foreground:boolean,run:()=>Promise<void>):Promise<void>{
    return new Promise((resolve,reject)=>{this.jobs.push({path,foreground,run,resolve,reject});this.next();});
  }
  prioritize(path:string):void {for(const job of this.jobs)if(job.path===path)job.foreground=true;}
  private next():void {
    if(this.running||!this.jobs.length)return;
    const priority=this.jobs.findIndex(job=>job.foreground);
    const job=this.jobs.splice(priority<0?0:priority,1)[0];this.running=true;
    void Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{this.running=false;this.next();});
  }
}
