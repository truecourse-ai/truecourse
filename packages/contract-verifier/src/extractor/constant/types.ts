/**
 * Code-side constant extraction output. Each shape produces one
 * record; the comparator matches by name (case-normalized) and
 * deep-equals the value.
 */

import type { SourceLocation } from '../../types/index.js';

export type ConstantShape =
  | 'const-literal'   // const X = <literal>
  | 'object-property' // const X = { key: <literal>, ... }  — one record per property
  | 'default-arg';    // function f(name = <literal>)

export interface ExtractedConstant {
  name: string;
  value: unknown;
  shape: ConstantShape;
  source: SourceLocation;
}
