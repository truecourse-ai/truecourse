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

// Positive: unused-function-parameter — Next.js route handler pattern
export async function routeHandler(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    return await Promise.resolve(Response.json({ id: params.id }));
  } catch {
    return Response.json({ error: 'fail' });
  }
}

// Positive: dot-notation-enforcement — bracket access on Record type
export function recordAccess(input: Record<string, number>): number { const counts: Record<string, number> = input; return counts['active'] || 0; }

// Positive: ungrouped-shorthand-properties — domain-grouped shorthand/non-shorthand
export function groupedProps(name: string, age: number): Record<string, unknown> {
  return { name, age, title: 'Dr.', address: '123 St' };
}

// Positive: unnamed-regex-capture — alternation-only group (not a capture)
export function matchExtension(url: string): boolean { return /\.css(\?|$)/iu.test(url); }

// Positive: unnecessary-boolean-compare — strict comparison on tri-state
export function triStateCheck(flag: boolean | null): string { return flag === true ? 'yes' : 'no'; }

// Positive: empty-function / no-empty-function — catch with empty handler
export function fireAndForget(): void { Promise.resolve().catch(() => {}); }

// Positive: type-guard-preference — classification with complex logic
export function classify(x: unknown): boolean {
  if (typeof x === 'string') return true;
  if (typeof x === 'number') return x > 0;
  return false;
}

// Positive: default-case-in-switch — exhaustive switch on string union
export function exhaustiveAction(a: 'start' | 'stop' | 'pause'): string {
  switch (a) { case 'start': return 'go'; case 'stop': return 'halt'; case 'pause': return 'wait'; }
  return '';
}

// Positive: missing-destructuring — access on type-asserted expression
export function anyAccess(data: unknown): string { const name = (data as Record<string, unknown>).name; return String(name); }

// Positive: unused-scope-definition — variable used in shorthand property
export function shorthandUsage(): Record<string, number> { const count = 42; return { count }; }

// Positive: static-method-candidate — method in class with extends (override)
class Base { prefix = ''; process(s: string): string { return this.prefix + s; } }
export class Handler extends Base { process(s: string): string { return s.toUpperCase(); } }

// Positive: useless-concat — multi-line string literal concatenation (compile-time constant)
const desc = `Hello world from here`;
export function getDesc(): string { return desc; }

// Positive: env-in-library-code — process.env.NODE_ENV in a config module
export const isDev = process.env.NODE_ENV === 'development';

// Positive: redundant-template-expression — template with || fallback (dynamic expression)
export function formatVal(val: string | null): string { return `Value: ${val || 'none'}`; }

// Positive: mutable-private-member — class with private readonly Map (container mutation is fine)
export class Registry {
  private readonly items = new Map<string, number>();
  set(k: string, v: number): void { this.items.set(k, v); }
  get(k: string): number | undefined { return this.items.get(k); }
}

// Positive: prefer-single-boolean-return — filter predicate with if/return true/return false
export function getPositive(nums: readonly number[]): number[] {
  return nums.filter((n) => {
    if (n > 0) return true;
    return false;
  });
}

// Positive: required-type-annotations — parameter with default value (inferred type)
export function greet(name = 'world'): string { return `Hello ${name}`; }

// Positive: missing-env-validation — env var validated on next line
export function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL required');
  return url;
}
