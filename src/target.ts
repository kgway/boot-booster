export const inside = (path: string, root: string) => path === root || path.startsWith(root + '/');
// Pure helpers do not assume the host's config folder. Live settings pass Vault.configDir.
export function validTarget(path: unknown, configDir = ''): path is string {
  if (typeof path !== 'string' || !path || path.includes('\\') || /[<>:"|?*]/.test(path) || [...path].some(c=>c.charCodeAt(0)<32)) return false;
  const parts = path.split('/');
  return !parts.some(p => !p || p.startsWith('.') || p.trim() !== p || p.endsWith('.') || ['__proto__','constructor','prototype'].includes(p))
    && !inside(path,configDir) && !inside(configDir,path);
}
export interface Scope { all: boolean; folders: string[]; }
export function normalizeScope(scope: Scope, configDir = ''): Scope {
  if(scope.all) return {all:true,folders:[]};
  const folders=[...new Set(scope.folders.filter(p=>validTarget(p,configDir)))].sort();
  return {all:false,folders:folders.filter(p=>!folders.some(other=>other!==p&&inside(p,other)))};
}
export const selected = (path: string, scope: Scope) => scope.all || scope.folders.some(p=>inside(path,p));
export const scopeKey = (scope: Scope) => JSON.stringify(normalizeScope(scope));
