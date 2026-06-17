/**
 * Lift `fallback <id> { … }` into a typed FallbackContract.
 *
 * A fallback is a standalone RUNTIME null/absent → default coalescing rule:
 * "when <target> is null/absent, fall back to <default-value>". It captures
 * the code that substitutes a missing value at read/use time — distinct from
 * a schema/DB column default, which is persisted and lives on an Entity field.
 *
 * Syntax:
 *
 *   fallback booking.currency-default {
 *     origin SPEC.md "Booking defaults" 30..36   // read by the resolver
 *     target Entity:Booking.currency             // or a bare input ident
 *     when null-or-absent                         // absent | null | null-or-absent
 *     default "USD"                               // ident | string | number | bool | null
 *   }
 *
 * `target` is either an entity field (`Entity:E.field`, captured as
 * `{ entity, field }`) or a bare input identifier (`{ field }`). The
 * `default` value reuses the QueryRule LiteralValue vocabulary so a
 * string/number/boolean/null/identifier default parses with one literal
 * algebra shared across kinds — no new value grammar.
 */

import type { HeadToken, StatementNode } from '../../parser/index.js';
import type { ArtifactRef, FallbackContract, LiteralValue } from '../../types/index.js';

const VALID_TRIGGERS = new Set<FallbackContract['trigger']>([
  'absent',
  'null',
  'null-or-absent',
]);

export function liftFallback(body: StatementNode[]): FallbackContract {
  let target: FallbackContract['target'] = { field: '' };
  let trigger: FallbackContract['trigger'] = 'null-or-absent';
  let defaultValue: LiteralValue | undefined;

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'target') {
      target = parseTarget(h[1]);
      continue;
    }
    if (k === 'when' && h[1]?.kind === 'ident') {
      if (VALID_TRIGGERS.has(h[1].value as FallbackContract['trigger'])) {
        trigger = h[1].value as FallbackContract['trigger'];
      }
      continue;
    }
    if (k === 'default' && h[1] !== undefined) {
      const v = literalFromToken(h[1]);
      if (v) defaultValue = v;
      continue;
    }
  }

  return {
    target,
    trigger,
    // A fallback with no parseable default is degenerate but never dropped:
    // surface it as an explicit null so downstream review sees the gap.
    defaultValue: defaultValue ?? { kind: 'null' },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `target` operand. An `Entity:E.field` reference splits into an
 * entity ref + the right-most field segment; a bare ident is a free-standing
 * input/field name with no entity binding.
 */
function parseTarget(t: HeadToken | undefined): FallbackContract['target'] {
  if (!t) return { field: '' };
  if (t.kind === 'reference') {
    const entity: ArtifactRef = {
      type: t.refType as ArtifactRef['type'],
      identity: stripField(t.identity),
      quoted: t.quoted,
    };
    return { entity, field: lastField(t.identity) };
  }
  if (t.kind === 'ident') {
    // A dotted bare ident (`input.reason`) keeps only the last segment as the
    // field; there's no entity to bind to.
    return { field: lastField(t.value) };
  }
  return { field: '' };
}

/** `Booking.currency` → `Booking`; `currency` → `currency` (no dot). */
function stripField(identity: string): string {
  const lastDot = identity.lastIndexOf('.');
  return lastDot < 0 ? identity : identity.slice(0, lastDot);
}

/** `Booking.currency` → `currency`; `currency` → `currency`. */
function lastField(identity: string): string {
  const lastDot = identity.lastIndexOf('.');
  return lastDot < 0 ? identity : identity.slice(lastDot + 1);
}

function literalFromToken(t: HeadToken): LiteralValue | null {
  switch (t.kind) {
    case 'string':
      return { kind: 'string', value: t.value };
    case 'number':
      return { kind: 'number', value: t.value };
    case 'ident': {
      const v = t.value;
      if (v === 'true') return { kind: 'boolean', value: true };
      if (v === 'false') return { kind: 'boolean', value: false };
      if (v === 'null') return { kind: 'null' };
      // A bare ident default is an identifier reference (a named constant or
      // enum member used as the default), preserved verbatim.
      return { kind: 'identifier', ref: v };
    }
    default:
      return null;
  }
}
