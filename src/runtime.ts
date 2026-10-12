/** Values crossing an untyped host, bridge or JSON boundary stay unknown until checked. */
export type UnknownRecord = Record<string, unknown>;
export type HostMethod = (this: unknown, ...args: unknown[]) => unknown;
export const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && !Array.isArray(value);
export const record = (value: unknown): UnknownRecord => isRecord(value) ? value : {};
export const isMethod = (value: unknown): value is HostMethod => typeof value === 'function';
export const isThenable = (value: unknown): value is PromiseLike<unknown> => isMethod(record(value).then);
export const parseJSON = (value: string): unknown => JSON.parse(value) as unknown;
export function callMethod(host:unknown,name:string,...args:unknown[]):unknown {
  const method=record(host)[name];return isMethod(method)?method.apply(host,args):undefined;
}
