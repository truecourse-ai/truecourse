/**
 * ArchitectureDecision comparator. For each spec-side
 * `architecture-decision`, diff the asserted choice against what the
 * category detector observed in the code.
 *
 * Drift kinds (`obligationKey` formats):
 *
 *   architecture.${category}.unmet-choice          critical
 *     Spec asserts X; the detector did NOT observe X (it observed only
 *     other things, or a determinate `none`).
 *
 *   architecture.${category}.forbidden-alternative critical
 *     The detector observed a real alternative (signals present) that
 *     isn't the chosen value — the spec's choice and this one conflict.
 *
 *   architecture.${category}.inconclusive          info
 *     The detector found no signal from any alternative, so the claim
 *     wasn't testable — surfaced rather than silently passed.
 *
 * An observation with empty signals is the detector's "absence" sentinel
 * (messaging `none`, runtime `node`); it can drive `unmet-choice` but is
 * never itself a forbidden alternative.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArchitectureDecisionContract,
  ArtifactRef,
  ContractDrift,
  Severity,
  SpecOrigin,
} from '../types/index.js';
import type { DetectedArchitectureChoice } from '../extractor/architecture/types.js';

export interface ArchitectureDecisionCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: ArchitectureDecisionContract;
  detected: DetectedArchitectureChoice;
  /** Code dir, used as the drift anchor when there's no specific site. */
  codeDir: string;
}

export function compareArchitectureDecision(input: ArchitectureDecisionCompareInput): ContractDrift[] {
  const { ref, origin, contract, detected, codeDir } = input;
  const { category, chosen, reason } = contract;
  const why = reason ? ` Rationale: ${reason}` : '';

  // No structured choice — the contract body contained only free-form `decision` text;
  // the lifter defaulted `chosen` to ''. Nothing to compare.
  if (!chosen) return [];

  // Inconclusive — no signal either way. Info, never a false positive.
  if (detected.confidence === 'inconclusive') {
    return [
      mk(ref, origin, `architecture.${category}.inconclusive`, 'info', codeDir, 0,
        `Spec asserts ${category} = \`${chosen}\`, but no ${category} signals were found in the code — the claim is not testable from current signals.${why}`,
        `${category}: ${chosen}`, '<no signals>'),
    ];
  }

  const drifts: ContractDrift[] = [];
  const observedValues = new Set(detected.observed.map((o) => o.value));

  // Unmet-choice — the asserted value isn't present.
  if (!observedValues.has(chosen)) {
    const observedDesc =
      detected.observed.length > 0
        ? detected.observed.map((o) => o.value).join(', ')
        : 'nothing';
    drifts.push(
      mk(ref, origin, `architecture.${category}.unmet-choice`, 'critical', codeDir, 0,
        `Spec asserts ${category} = \`${chosen}\`, but it was not detected in the code (observed: ${observedDesc}).${why}`,
        `${category}: ${chosen}`, observedDesc),
    );
  }

  // Forbidden-alternative — a real (signal-backed) alternative is in use.
  const rejected = new Set(contract.rejectedAlternatives ?? []);
  for (const o of detected.observed) {
    if (o.value === chosen) continue;
    if (o.signals.length === 0) continue; // absence sentinel, not an alternative
    const sig = o.signals[0];
    drifts.push(
      mk(ref, origin, `architecture.${category}.forbidden-alternative`, 'critical', sig.source.filePath, sig.source.lineStart,
        `Spec asserts ${category} = \`${chosen}\`, but \`${o.value}\` is also in use (${sig.detail})${rejected.has(o.value) ? ' — explicitly rejected by the spec' : ''}.${why}`,
        `${category}: ${chosen}`, `${o.value} (${sig.detail})`),
    );
  }

  return dedupe(drifts);
}

function mk(
  ref: ArtifactRef,
  origin: SpecOrigin | null,
  obligationKey: string,
  severity: Severity,
  filePath: string,
  lineStart: number,
  message: string,
  specSide: string,
  codeSide: string,
): ContractDrift {
  return {
    id: randomUUID(),
    type: 'contract-drift',
    artifactRef: ref,
    obligationKey,
    severity,
    filePath,
    lineStart,
    lineEnd: lineStart,
    message,
    specSide,
    codeSide,
    specOrigin: origin ?? undefined,
  };
}

function dedupe(drifts: ContractDrift[]): ContractDrift[] {
  // Collapse on obligationKey — `forbidden-alternative` carries no
  // per-value suffix, so multiple offending alternatives are one drift.
  const seen = new Set<string>();
  const out: ContractDrift[] = [];
  for (const d of drifts) {
    if (seen.has(d.obligationKey)) continue;
    seen.add(d.obligationKey);
    out.push(d);
  }
  return out;
}
