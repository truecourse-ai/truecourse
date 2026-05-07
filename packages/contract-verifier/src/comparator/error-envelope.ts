/**
 * ErrorEnvelope comparator. Walks every extracted Operation's error
 * responses (status class 4xx/5xx) and checks that the code-side body
 * has the `error` top-level field — the wrapped shape the spec requires.
 *
 * v1 enforces *shape conformance*, not *field-content conformance*. We
 * don't yet check that `error.code` is in the known-codes list or that
 * `error.message` is human-readable — those are richer comparators that
 * land when we have schema-aware body extraction.
 */

import { randomUUID } from 'node:crypto';
import type {
  ContractDrift,
  ArtifactRef,
  ErrorEnvelopeContract,
} from '../types/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface ErrorEnvelopeCompareInput {
  /** The error-envelope artifact ref (`ErrorEnvelope:error.envelope.standard`). */
  envelopeRef: ArtifactRef;
  /** The lifted contract — currently used for `appliesTo.statusClass`. */
  contract: ErrorEnvelopeContract;
  /** Every extracted code-side operation. */
  extractedOps: ExtractedOperation[];
}

export function compareErrorEnvelope(input: ErrorEnvelopeCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  // Build the matcher predicate from `appliesTo.statusClass`.
  const classes = input.contract.appliesTo.statusClass.map((c) => c.toLowerCase());
  const matchesClass = (status: string): boolean => {
    if (!/^\d{3}$/.test(status)) return false;
    const lead = status[0];
    return classes.includes(`${lead}xx`);
  };

  for (const op of input.extractedOps) {
    for (const resp of op.contract.responses) {
      if (!matchesClass(resp.status)) continue;
      if (!resp.body) continue;
      // The body must be a wrapped object with `error` as a top-level key.
      // v1 detection: classifyJsonArg in the extractor produces `fields`
      // for object literals — check for `error` membership.
      if (resp.body.fields && Object.prototype.hasOwnProperty.call(resp.body.fields, 'error')) {
        continue; // satisfied
      }
      // The classifier records `bare-array` via `errorCode`; not an envelope shape either.
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.envelopeRef,
        obligationKey: `${op.identity}/response.${resp.status}.shape`,
        severity: 'critical',
        filePath: op.filePath,
        lineStart: op.declarationLine,
        lineEnd: op.declarationLine,
        message:
          `Response ${resp.status} on ${op.identity} must use the wrapped error envelope ` +
          `(\`{ error: { code, message, details? } }\`). Implementation emits a different shape.`,
        specSide: `body envelope ${input.envelopeRef.type}:${input.envelopeRef.identity}`,
        codeSide: resp.body.fields
          ? `body keys: ${Object.keys(resp.body.fields).join(', ')}`
          : `body shape unrecognized`,
      });
    }
  }

  return out;
}
