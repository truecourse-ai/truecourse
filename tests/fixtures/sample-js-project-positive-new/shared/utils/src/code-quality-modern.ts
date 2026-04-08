import { readFileSync } from 'fs';
export function restParams(...args: readonly unknown[]): unknown[] { return Array.from(args); }
export function spreadMax(arr: readonly number[]): number { return Math.max(...arr); }
export function* generatorWithYield(): Generator<number> { yield 42; }
export function includesCheck(arr: readonly number[], item: number): boolean { return arr.includes(item); }
export function templateString(name: string): string { return `Hello, ${name}`; }
export class Service {
  name = 'service';
  toString(): string { return this.name; }
}
export function readSync(): typeof readFileSync { return readFileSync; }
