/**
 * Emission facts re-keyer.
 *
 * Historical context: this module used to walk each operation's
 * `handlerBody` (a tree-sitter `SyntaxNode`) at comparison time to collect
 * emit() calls, dynamic emits, failure-block emits, and branch emits.
 * That kept tree-sitter `Tree` objects alive in the WASM heap until the
 * end of every verify run, which exhausted the heap on large monorepos
 * (4500+ files crashed payloadcms).
 *
 * The AST walking now happens eagerly in the operation extractor (see
 * `../handler-facts.ts`), and the result is stored on
 * `ExtractedOperation.emission` as plain data — Sets/Maps of strings and
 * line numbers, no node references. The `Tree` is freed per-file as
 * extraction completes.
 *
 * This module's only job now is to re-key the per-op emission facts by
 * `op.identity` for the consumers (`compareEffectGroup`) that prefer a
 * `Map<identity, facts>` lookup over walking `ops[]`.
 */

import type { ExtractedOperation } from '../operation.js';
import type { OperationEmission as HandlerEmission } from '../handler-facts.js';

export type { FailureEmitSite } from '../handler-facts.js';

/** Re-export the shape the comparator consumes, plus the per-op locator
 *  fields (filePath / declarationLine) so failure-site emission entries
 *  can be located without dereferencing the original op. */
export interface OperationEmission extends HandlerEmission {
  filePath: string;
  declarationLine: number;
}

/** opIdentity → emission facts. Only handlers we could resolve are present. */
export type EmissionFacts = Map<string, OperationEmission>;

export function extractEmissionFacts(ops: ExtractedOperation[]): EmissionFacts {
  const facts: EmissionFacts = new Map();
  for (const op of ops) {
    if (!op.emission) continue;
    facts.set(op.identity, {
      filePath: op.filePath,
      declarationLine: op.declarationLine,
      ...op.emission,
    });
  }
  return facts;
}
