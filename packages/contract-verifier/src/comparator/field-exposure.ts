/**
 * FieldExposure comparator. Diffs a spec-side read-path exposure obligation
 * ("field <target> must be exposed via <channels>") against the
 * `ExtractedFieldExposure` records the code-side extractor produced from the
 * projection (ORM select) and response-serializer sites.
 *
 * Adapter- and language-agnostic: both sides carry a typed
 * `FieldExposureContract`, so the diff is structural and works the same against
 * a TS Prisma `select` / `res.json`, a Django `.values()` / `jsonify`, or any
 * other projection/response site.
 *
 * Matching strategy — name-independent, by STRUCTURE:
 *
 *   A spec exposure matches a code exposure when their target FIELDS agree
 *   (normalized, cross-convention `loyalty_tier` ≡ `loyaltyTier`). The
 *   author-chosen artifact identity is never used to match —
 *   `customer.loyalty-tier-exposed` (spec) lines up with the code exposure
 *   whose extracted identity is `loyaltyTier.exposure`. The dispatcher unions
 *   channels per field, so one code record carries every channel the field is
 *   seen on.
 *
 * Drift kinds (`obligationKey` formats):
 *
 *   field-exposure.${identity}.not-exposed       high
 *     Spec states the field is on the read path, but no code site projects or
 *     returns it — the field never reaches the consumer. The headline drift:
 *     a value the contract promises is silently dropped from every read path.
 *
 *   field-exposure.${identity}.channel-missing   high
 *     The field is exposed, but NOT through a channel the contract requires
 *     (spec wants `query-select` + `api-response`, code only returns it in the
 *     response without selecting it — or selects it but never serializes it
 *     back). The value is partially exposed, so the read path is incomplete.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  FieldExposureContract,
  Severity,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedFieldExposure } from '../extractor/field-exposure/types.js';

type Channel = FieldExposureContract['exposedVia'][number];

export interface FieldExposureCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: FieldExposureContract;
  /** Every field exposure the code-side extractor found. The comparator does
   *  its own structural match — it is NOT pre-filtered by the orchestrator. */
  codeExposures: ExtractedFieldExposure[];
}

export function compareFieldExposure(input: FieldExposureCompareInput): ContractDrift[] {
  const { ref, contract, codeExposures } = input;
  const specField = normalize(contract.target.field);

  // Candidate code exposures: same target field (normalized, cross-convention).
  // The dispatcher already collapsed a field to one record carrying every
  // channel it is exposed on, so there is at most one candidate — but we union
  // defensively in case an upstream caller passes un-deduped records.
  const candidates = codeExposures.filter(
    (e) => normalize(e.contract.target.field) === specField,
  );

  if (candidates.length === 0) {
    return [{
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `field-exposure.${ref.identity}.not-exposed`,
      severity: 'high' as Severity,
      filePath: ref.identity,
      lineStart: 0,
      lineEnd: 0,
      message:
        `Spec states \`${contract.target.field}\` is exposed on the read path ` +
        `(${describeChannels(contract.exposedVia)}), but no code site projects ` +
        `or returns it.`,
      specSide: describeExposure(contract),
      codeSide: '<no projection/response site found>',
    }];
  }

  // The field is exposed somewhere. Union every channel the code exposes it on,
  // then check each channel the contract requires is present. A channel the
  // contract does not mention is not required — extra code-side channels are
  // tolerated (the field reaching MORE read paths than promised is not drift).
  const codeChannels = new Set<Channel>();
  for (const c of candidates) for (const ch of c.contract.exposedVia) codeChannels.add(ch);

  const missing = contract.exposedVia.filter((ch) => !codeChannels.has(ch));
  if (missing.length === 0) return [];

  const m = candidates[0];
  return [{
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey: `field-exposure.${ref.identity}.channel-missing`,
    severity: 'high',
    filePath: m.source.filePath,
    lineStart: m.source.lineStart,
    lineEnd: m.source.lineEnd,
    message:
      `Spec exposes \`${contract.target.field}\` via ${describeChannels(contract.exposedVia)}, ` +
      `but the code only exposes it via ${describeChannels([...codeChannels])} ` +
      `(missing ${describeChannels(missing)}).`,
    specSide: describeChannels(contract.exposedVia),
    codeSide: describeChannels([...codeChannels]),
  }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cross-convention field normalization (`loyalty_tier` ≡ `loyaltyTier`). */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function describeChannels(channels: Channel[]): string {
  return channels.length ? channels.join(' + ') : '<none>';
}

function describeExposure(c: FieldExposureContract): string {
  return `${c.target.field} via ${describeChannels(c.exposedVia)}`;
}
