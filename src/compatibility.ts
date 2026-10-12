// These releases share the Android adapter contract inspected in the official APKs.
// Unknown releases must use Obsidian's normal scanner until validated.
const androidAdapterVersions = new Set(['1.13.8', '1.14.4']);
export const supportsAndroidAdapter = (api:string):boolean => androidAdapterVersions.has(api);
export const compatibleInventory = (cachedApi:string, api:string):boolean =>
  cachedApi===api || (supportsAndroidAdapter(cachedApi)&&supportsAndroidAdapter(api));
