// Split out of code-quality-misc.ts to keep both files under the
// god-module threshold. Each export here still validates a specific
// rule heuristic; see comments on individual functions/classes.

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
