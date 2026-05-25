/**
 * Code-side enum extraction output. Each enum-shape produces one
 * ExtractedEnum record. The verifier comparator matches spec
 * EnumContract artifacts to ExtractedEnum entries by name (with
 * loose case/style normalization).
 */

import type { SourceLocation } from '../../types/index.js';

export type EnumShape =
  | 'ts-union'           // type X = 'a' | 'b' | 'c'
  | 'ts-enum'            // enum X { A = 'a', B = 'b' }
  | 'zod-enum'           // z.enum(['a', 'b'])
  | 'zod-union'          // z.union([z.literal('a'), z.literal('b')])
  | 'as-const-object'    // const X = { A: 'a' } as const
  | 'set-literal'        // const VALID_X = new Set(['a', 'b'])
  | 'array-literal';     // const VALID_X = ['a', 'b'] (with conventional name)

export interface ExtractedEnum {
  /** Identifier in code — type name, const name, or property key. */
  name: string;
  /** The string values (sorted alphabetically for stable comparison). */
  values: string[];
  shape: EnumShape;
  source: SourceLocation;
}
