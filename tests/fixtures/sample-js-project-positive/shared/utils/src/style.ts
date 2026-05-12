/**
 * Style patterns -- clean formatting, naming, import organization.
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';

export function myFunction(): number {
  return 42;
}

export function properIndent(): number {
  const a = 1;
  const b = 2;
  return a + b;
}

export function placeholder(): null {
  return null;
}

export interface ConfigInterface {
  value: string;
}

export { writeFileSync, readFileSync, createServer };



/**
 * Global type augmentation for module-level singletons.
 *
 * Inside a `declare global` block, only `var` is legal syntax — `const`
 * and `let` are rejected by the TypeScript compiler. This is the standard
 * idiom for typing values that live on `globalThis` (dev-mode caches,
 * provider singletons, etc.). The rule fires on the `var` token here even
 * though there is no behavioural alternative.
 */
interface UtilCacheEntry {
  readonly key: string;
  readonly value: unknown;
}

interface UtilProvider {
  readonly id: string;
  resolve(key: string): UtilCacheEntry | undefined;
}

declare global {
  // Mode shape-7d0d89b03952: `var X: Type;` (no union).
  // eslint-disable-next-line no-var
  var __style_util_remember__: Map<string, UtilCacheEntry>;

  // Mode shape-9f9e92bd6982: `var X: Type | undefined;` (optional union).
  // eslint-disable-next-line no-var
  var __style_util_provider__: UtilProvider | undefined;
}

export function rememberStyleValue(key: string, value: unknown): UtilCacheEntry {
  if (globalThis.__style_util_remember__ === undefined) {
    globalThis.__style_util_remember__ = new Map<string, UtilCacheEntry>();
  }
  const entry: UtilCacheEntry = { key, value };
  globalThis.__style_util_remember__.set(key, entry);
  return entry;
}

export function getStyleProvider(): UtilProvider | undefined {
  return globalThis.__style_util_provider__;
}
