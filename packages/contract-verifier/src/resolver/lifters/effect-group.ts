import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { EffectGroupContract, ArtifactRef, ForbidClause } from '../../types/index.js';

/**
 * Lift an `effect-group` body. Each inner `effect <name> { … }` produces
 * one entry with its emit-when (operation + status) so the comparator
 * can map "this event must fire when that op returns that status".
 */
export function liftEffectGroup(body: StatementNode[]): EffectGroupContract {
  let channel = 'event-bus';
  const effects: EffectGroupContract['effects'] = [];
  const forbids: ForbidClause[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'channel' && h[1]?.kind === 'ident') {
      channel = h[1].value;
      continue;
    }

    if (k === 'effect' && h[1]?.kind === 'ident' && stmt.block) {
      const identity = h[1].value;
      let opRef: ArtifactRef | null = null;
      let onStatus = '';
      const payloadConstraint: Record<string, string | number | boolean> = {};

      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length === 0 || ih[0].kind !== 'ident') continue;

        if (ih[0].value === 'emit-when' && inner.block) {
          for (const ew of inner.block) {
            const ewh = ew.head;
            if (ewh[0]?.kind !== 'ident') continue;
            if (ewh[0].value === 'operation' && ewh[1]?.kind === 'reference') {
              opRef = {
                type: ewh[1].refType as ArtifactRef['type'],
                identity: ewh[1].identity,
                quoted: ewh[1].quoted,
              };
            } else if (ewh[0].value === 'on-status') {
              if (ewh[1]?.kind === 'string') onStatus = ewh[1].value;
              else if (ewh[1]?.kind === 'number') onStatus = String(ewh[1].value);
              else if (ewh[1]?.kind === 'ident') onStatus = ewh[1].value;
            }
          }
        }

        if (ih[0].value === 'payload-constraint') {
          // `payload-constraint status = "placed"` style (head: ident('payload-constraint'), ident(field), op('='), value)
          if (ih[1]?.kind === 'ident' && ih[2]?.kind === 'op' && ih[2].value === '=') {
            const v = ih[3];
            if (v?.kind === 'string') payloadConstraint[ih[1].value] = v.value;
            else if (v?.kind === 'number') payloadConstraint[ih[1].value] = v.value;
            else if (v?.kind === 'ident') payloadConstraint[ih[1].value] = v.value;
          }
        }
      }

      if (opRef && onStatus) {
        effects.push({
          identity,
          emitWhen: { operationRef: opRef, onStatus },
          payloadConstraint: Object.keys(payloadConstraint).length > 0 ? payloadConstraint : undefined,
        });
      }
      continue;
    }

    if (k === 'forbids' && stmt.block) {
      for (const inner of stmt.block) {
        const ih = inner.head;
        if (ih.length < 2 || ih[0].kind !== 'ident' || ih[0].value !== 'forbid') continue;
        if (ih[1].kind === 'ident' && ih[1].value === 'emission') {
          // `forbid emission when-response-status [4xx, 5xx]`
          forbids.push({ kind: 'emission' });
        }
      }
      continue;
    }
  }

  return {
    channel,
    payloadShape: {},
    effects,
    forbids,
  };
}
