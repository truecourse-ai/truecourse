/**
 * EffectGroup comparator — a pure diff of spec-declared effects against the
 * code-side `EmissionFacts` (extracted by extractor/effect/emission-facts.ts).
 * All handler-AST analysis now lives in the extractor; this file only compares.
 * Two checks, unchanged in meaning:
 *
 *   1. MISSING EMISSION (spec says `order.cancelled` emits on
 *      `POST /api/orders/{id}/cancel`, code never emits it).
 *   2. FORBIDDEN EMISSION on failure (spec forbids emission on 4xx/5xx;
 *      code emits an event from a block that ALSO returns a 4xx/5xx).
 */

import { randomUUID } from 'node:crypto';
import type { ContractDrift, ArtifactRef, EffectGroupContract, SpecOrigin } from '../types/index.js';
import type { EmissionFacts } from '../extractor/effect/emission-facts.js';

export interface EffectGroupCompareInput {
  effectGroupRef: ArtifactRef;
  /** Spec-side origin of the effect-group artifact (source doc + section). */
  origin: SpecOrigin | null;
  contract: EffectGroupContract;
  /** Per-operation emission facts for every recognized operation. */
  emission: EmissionFacts;
}

export function compareEffectGroup(input: EffectGroupCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  for (const effect of input.contract.effects) {
    const opIdentity = effect.emitWhen.operationRef.identity;
    const facts = input.emission.get(opIdentity);
    if (!facts) continue;

    const events = [...facts.staticEvents];
    const emitsThisEffect = facts.staticEvents.has(effect.identity);

    const branchKey =
      (typeof effect.payloadConstraint?.status === 'string'
        ? effect.payloadConstraint.status
        : null) ?? effect.identity.split('.').pop() ?? '';

    const be = facts.branchEmits.get(branchKey);
    const branchSkipped = be ? !be.consequentEmits && be.alternativeEmits : false;

    if (!emitsThisEffect && (!facts.hasDynamicEmit || branchSkipped)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.effectGroupRef,
        obligationKey: `Effect:${effect.identity} / missing-emission`,
        severity: 'critical',
        filePath: facts.filePath,
        lineStart: facts.declarationLine,
        lineEnd: facts.declarationLine,
        message:
          `Effect \`${effect.identity}\` is declared to emit on ${opIdentity} ` +
          `(status ${effect.emitWhen.onStatus}) but the handler never emits ` +
          `\`${effect.identity}\` along any code path.`,
        specSide: `effect ${effect.identity} emit-when ${opIdentity} on-status ${effect.emitWhen.onStatus}`,
        codeSide: branchSkipped
          ? `branch for '${branchKey}' exists but contains no emit while sibling branches do`
          : events.length > 0
            ? `handler emits: ${events.join(', ')}`
            : `handler does not emit any tracked event`,
        specOrigin: input.origin ?? undefined,
      });
    }
  }

  if (input.contract.forbids.some((f) => f.kind === 'emission')) {
    for (const [opIdentity, facts] of input.emission) {
      for (const site of facts.failureEmitSites) {
        out.push({
          id: randomUUID(),
          type: 'contract-drift',
          artifactRef: input.effectGroupRef,
          obligationKey: `Effect:${site.event} / forbidden-emission-on-failure`,
          severity: 'critical',
          filePath: facts.filePath,
          lineStart: site.lineStart,
          lineEnd: site.lineEnd,
          message:
            `Effect \`${site.event}\` is emitted from a code path that also ` +
            `returns a 4xx/5xx response on ${opIdentity}. The spec forbids ` +
            `emission on failure responses.`,
          specSide: `forbid emission when-response-status [4xx, 5xx]`,
          codeSide: `emit \`${site.event}\` co-located with a 4xx/5xx response`,
          specOrigin: input.origin ?? undefined,
        });
      }
    }
  }

  return out;
}
