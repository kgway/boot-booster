import type {Setting} from 'obsidian';
/** Structural subset of Obsidian 1.13's declarative settings API.
 * Type-only: older supported hosts still render the same rows through display().
 * https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts */
export interface SettingRow {
  name:string;desc?:string;visible?:boolean;searchable?:boolean;
  render(setting:Setting):void|(()=>void);
}
export interface SettingSection {type:'group';heading?:string;items:SettingRow[];}
export type SettingItem=SettingRow|SettingSection;
