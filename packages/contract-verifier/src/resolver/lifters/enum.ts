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
 *     value MISSING "Signature missing"  // optional per-value label
 *     trigger-subset flagging [MISSING, PARTIAL, SUSPECT, OUTLIER]
 *     trigger-subset non-pass [MISSING, PARTIAL, SUSPECT, OUTLIER]
 *   }
 *
 * `value <NAME> "label"` attaches the human-facing meaning the spec states
 * for a value. A `value` clause naming a value not in `values` also adds it
 * to the value set, so an enum declared purely through labeled values still
 * resolves.
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { EnumContract } from '../../types/index.js';

export function liftEnum(body: StatementNode[]): EnumContract {
  let representation: 'string-literal' | 'integer' = 'string-literal';
  let closed = true;
  let values: string[] = [];
  const valueLabels: Record<string, string> = {};
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
    const nameTok = h[1];
    const labelTok = h[2];
    if (
      k === 'value' &&
      nameTok !== undefined &&
      (nameTok.kind === 'ident' || nameTok.kind === 'string') &&
      labelTok?.kind === 'string'
    ) {
      valueLabels[nameTok.value] = labelTok.value;
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

  // A `value` clause may introduce a value the `values [...]` list omitted.
  for (const name of Object.keys(valueLabels)) {
    if (!values.includes(name)) values.push(name);
  }

  return {
    representation,
    closed,
    values,
    ...(Object.keys(valueLabels).length > 0 ? { valueLabels } : {}),
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
