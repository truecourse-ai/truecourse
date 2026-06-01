/**
 * Lift `enum <Name> { values [...] trigger-subset <name> [...] }`
 * into a typed EnumContract.
 *
 * Grammar:
 *
 *   enum SignatureClassification {
 *     representation string-literal     // optional, default string-literal
 *     closed                            // optional flag, default true
 *     values [PASS, MISSING, PARTIAL, SUSPECT, OUTLIER]
 *     trigger-subset flagging [MISSING, PARTIAL, SUSPECT, OUTLIER]
 *     trigger-subset non-pass [MISSING, PARTIAL, SUSPECT, OUTLIER]
 *   }
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { EnumContract } from '../../types/index.js';

export function liftEnum(body: StatementNode[]): EnumContract {
  let representation: 'string-literal' | 'integer' = 'string-literal';
  let closed = true;
  let values: string[] = [];
  const triggerSubsets: { name: string; values: string[] }[] = [];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'representation' && h[1]?.kind === 'ident') {
      if (h[1].value === 'integer') representation = 'integer';
      continue;
    }
    if (k === 'closed') {
      closed = true;
      continue;
    }
    if (k === 'open') {
      closed = false;
      continue;
    }
    if (k === 'values' && h[1]?.kind === 'list') {
      values = listIdents(h[1]);
      continue;
    }
    if (k === 'trigger-subset' && h[1]?.kind === 'ident' && h[2]?.kind === 'list') {
      triggerSubsets.push({
        name: h[1].value,
        values: listIdents(h[2]),
      });
      continue;
    }
  }

  return {
    representation,
    closed,
    values,
    ...(triggerSubsets.length > 0 ? { triggerSubsets } : {}),
  };
}

function listIdents(list: Extract<HeadToken, { kind: 'list' }>): string[] {
  const out: string[] = [];
  for (const item of list.items) {
    if (item.kind === 'ident') out.push(item.value);
    else if (item.kind === 'string') out.push(item.value);
  }
  return out;
}
