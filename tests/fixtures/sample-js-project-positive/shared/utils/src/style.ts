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
