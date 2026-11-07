import {App,Modal,Notice,Setting} from 'obsidian';
import {CompatibilityControl} from './compatibility';
import {Translator} from './i18n';

export class CompatibilityPrompt extends Modal {
  constructor(app:App,private control:CompatibilityControl,private t:Translator){super(app);}
  onOpen():void{
    const t=this.t;this.titleEl.setText(t('versionPromptTitle'));
    this.contentEl.createEl('p',{text:t('versionPromptHelp',{api:this.control.api})});
    new Setting(this.contentEl).addButton(b=>b.setButtonText(t('keepNormal')).onClick(()=>this.close()))
      .addButton(b=>b.setButtonText(t('useThisVersion')).setCta().onClick(()=>{
        try{this.control.accept();this.close();new Notice(t('nextStartup'));}
        catch{new Notice(t('settingsSaveFailed'));}
      }));
  }
  onClose():void{this.contentEl.empty();}
}
