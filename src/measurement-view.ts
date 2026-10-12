import {Notice,Setting} from 'obsidian';
import {BenchmarkStore,StartupRun} from './benchmark';
import {seconds} from './feedback';
import {japanese,Language,MessageKey,Translator} from './i18n';

const RECENT_LIMIT=5;
/** The setting tab owns refresh; history controls belong to one native item. */
export class MeasurementView {
  private records:HTMLElement;private more:HTMLAnchorElement;private expanded=false;
  private box:HTMLTextAreaElement;private json:HTMLDetailsElement;private rendered='';
  private dateFormat:Intl.DateTimeFormat;
  constructor(el:HTMLElement,private store:BenchmarkStore,private current:()=>StartupRun|undefined,private t:Translator=japanese,private language:Language='ja',existing?:Setting){
    this.dateFormat=new Intl.DateTimeFormat(language==='ja'?'ja-JP':'en-US',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    const item=(existing??new Setting(el)).setName(t('history')).setDesc(t('historyHelp')).setClass('boot-booster-history');
    this.records=item.infoEl.createDiv({cls:'boot-booster-records',attr:{role:'region','aria-label':t('historyRegion'),tabindex:'0'}});
    this.more=item.infoEl.createEl('a',{attr:{href:'#',role:'button','aria-expanded':'false'}});
    this.more.addEventListener('click',event=>{event.preventDefault();this.expanded=!this.expanded;this.render(true);});
    this.more.addEventListener('keydown',event=>{if(event.key===' '){event.preventDefault();this.more.click();}});
    // Standard Obsidian buttons, below the table and outside the JSON disclosure.
    item.infoEl.appendChild(item.controlEl);
    item.addButton(b=>b.setButtonText(t('copy')).onClick(async()=>{
      try{await navigator.clipboard.writeText(this.store.export(this.current()));new Notice(t('copied'));}
      catch{this.json.open=true;this.box.value=this.store.export(this.current());this.box.focus();this.box.select();new Notice(t('copyManually'));}
    })).addButton(b=>b.setButtonText(t('clear')).onClick(()=>{
      try{this.store.clear(this.current());this.expanded=false;this.render(true);this.box.value=this.store.export(this.current());new Notice(t('cleared'));}
      catch{new Notice(t('clearFailed'));}
    }));
    this.json=item.infoEl.createEl('details',{cls:'boot-booster-record-json'});this.json.createEl('summary',{text:'JSON'});
    this.box=this.json.createEl('textarea',{cls:'boot-booster-report',attr:{readonly:'',rows:'12','aria-label':t('historyJson')}});
    this.json.addEventListener('toggle',()=>{if(this.json.open&&document.activeElement!==this.box)this.box.value=this.store.export(this.current());});
    this.render();
  }
  render(force=false):void{
    const current=this.current(),runs=this.store.runs(current).reverse(),t=this.t;
    const rows=runs.map(run=>[dateTime(run.startedAt,this.dateFormat),
      t(run.condition.mode==='measurement-only'?'normal':'optimized'),ms(run.milestones.uiReadyMs,t),phase(run,'readingFiles',t),phase(run,'loadingMetadata',t),phase(run,'workspaceLayout',t),ms(run.milestones.verificationMs,t),recordStatus(run,t)]);
    // Detailed plugin telemetry can change without affecting any table cells.
    const signature=JSON.stringify([this.expanded,rows]);
    if(this.json.open&&document.activeElement!==this.box)this.box.value=this.store.export(current);
    if(!force&&(signature===this.rendered||this.records.contains(document.activeElement)||this.records.contains(window.getSelection()?.anchorNode??null)))return;
    this.rendered=signature;
    this.more.hidden=runs.length<=RECENT_LIMIT;this.more.setText(t(this.expanded?'showLess':'showAll',{count:runs.length}));
    this.more.setAttribute('aria-expanded',String(this.expanded));
    const left=this.records.scrollLeft;this.records.empty();this.records.hidden=!runs.length;if(!runs.length)return;
    const table=this.records.createEl('table',{cls:'boot-booster-measurements'}),head=table.createEl('thead').createEl('tr');
    const headers:[MessageKey,MessageKey][]=[['date','dateHelp'],['mode','modeTip'],['ui','uiTip'],['list','listTip'],['index','indexTip'],['restore','restoreTip'],['verification','verificationTip'],['record','recordTip']];
    for(const [name,title] of headers)head.createEl('th',{text:t(name),attr:{scope:'col',title:t(title)}});
    const body=table.createEl('tbody');
    rows.forEach((cells,index)=>{const row=body.createEl('tr');row.hidden=!this.expanded&&index>=RECENT_LIMIT;for(const text of cells)row.createEl('td',{text});});
    this.records.scrollLeft=left;
  }
}
export function recordStatus(run:StartupRun,t:Translator=japanese):string{
  if(run.status==='interrupted'||run.status==='timeout')return t(run.milestones.uiReadyMs!=null?'backgroundInterrupted':'interrupted');
  return t(run.status==='complete'?'complete':'inProgress');
}
const ms=(n:number|null|undefined,t:Translator):string=>typeof n==='number'?seconds(n,t):'—';
const dateTime=(value:string,format:Intl.DateTimeFormat):string=>{const date=new Date(value);return Number.isNaN(date.getTime())?'—':format.format(date);};
function phase(run:StartupRun,key:string,t:Translator):string{const spans=run.phases[key];return spans?.length?spans.map(p=>`${ms(p.durationMs,t)}${p.ok?'':'×'}`).join(' / '):'—';}
