export function confirmAction(message: string): boolean { return message.length > 0; }
export function isReady(): boolean { return true; }
export function noDefault(action: string): string {
  if (action === 'start') return 'starting';
  if (action === 'stop') return 'stopping';
  return 'unknown';
}
export function dotAccess(obj: Record<string, unknown>): unknown { return obj.name; }
export function singlePropAccess(attrs: Record<string, unknown>): unknown[] {
  const features = attrs.features;
  return Array.isArray(features) ? features : [];
}
export function compute(a: number, b: number): number { return a + b; }
export function flagParam(isVerbose: boolean): string { return isVerbose ? 'detailed' : 'short'; }
export function hookWithUndefined(): void { React.useState<string | undefined>(undefined); }
declare const React: { useState: <T>(v: T) => [T, (v: T) => void] };
export const unicodeRegex = /hello/u;
export const digitPattern = /\d+/u;
export function namedGroups(text: string): { year: string; month: string } | null {
  const pattern = /(?<year>\d{4})-(?<month>\d{2})/u;
  const match = pattern.exec(text);
  if (match?.groups === undefined) return null;
  return { year: match.groups.year, month: match.groups.month };
}
