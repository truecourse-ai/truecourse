/**
 * Lift `field-exposure <id> { … }` into a typed FieldExposureContract.
 *
 * A field-exposure is the GENERAL "this field must be exposed on a read path"
 * obligation: the field is included in a data-access projection (ORM select),
 * and/or returned in an API response. It captures only the reliably
 * code-derivable core — a projection/response SITE — not fragile prop
 * threading through named files.
 *
 * Syntax:
 *
 *   field-exposure order.total-cents-exposed {
 *     origin SPEC.md "Order read API" 40..48   // read by the resolver
 *     field Entity:Order.totalCents             // or a bare field ident
 *     via query-select                          // one or more channels
 *     via api-response
 *     in Operation:"GET /api/orders/{id}"       // optional ref OR bare ident
 *   }
 *
 * `field` is either an entity field (`Entity:E.field`, captured as
 * `{ entity, field }`) or a bare field identifier (`{ field }`) — the same
 * dual target shape `fallback`/`validation-rule` admit, kept general across
 * features/ORMs. `via` repeats once per channel; the lifter dedupes and
 * preserves authored order. `in` is the optional operation/query the field is
 * exposed through — a cross-reference when named, a bare ident otherwise.
 */

import type { HeadToken, StatementNode } from '../../parser/index.js';
import type { ArtifactRef, FieldExposureContract } from '../../types/index.js';

type Channel = FieldExposureContract['exposedVia'][number];

const VALID_CHANNELS = new Set<Channel>(['query-select', 'api-response']);

export function liftFieldExposure(body: StatementNode[]): FieldExposureContract {
  let target: FieldExposureContract['target'] = { field: '' };
  const exposedVia: Channel[] = [];
  let through: FieldExposureContract['through'] | undefined;

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'field') {
      target = parseTarget(h[1]);
      continue;
    }
    if (k === 'via' && h[1]?.kind === 'ident') {
      const ch = h[1].value as Channel;
      // Dedupe — a channel declared twice collapses to one; authored order
      // of first appearance wins.
      if (VALID_CHANNELS.has(ch) && !exposedVia.includes(ch)) exposedVia.push(ch);
      continue;
    }
    if (k === 'in' && h[1] !== undefined) {
      const t = parseThrough(h[1]);
      if (t) through = t;
      continue;
    }
  }

  return through === undefined
    ? { target, exposedVia }
    : { target, exposedVia, through };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `field` operand. An `Entity:E.field` reference splits into an
 * entity ref + the right-most field segment; a bare ident is a free-standing
 * field name with no entity binding.
 */
function parseTarget(t: HeadToken | undefined): FieldExposureContract['target'] {
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
    return { field: lastField(t.value) };
  }
  return { field: '' };
}

/**
 * Parse the optional `in` operand. A cross-reference (`Operation:"…"`,
 * `QueryRule:…`) is preserved verbatim; a bare ident becomes `{ ident }`.
 */
function parseThrough(t: HeadToken): FieldExposureContract['through'] | null {
  if (t.kind === 'reference') {
    return { type: t.refType as ArtifactRef['type'], identity: t.identity, quoted: t.quoted };
  }
  if (t.kind === 'ident') {
    return { ident: t.value };
  }
  if (t.kind === 'string') {
    return { ident: t.value };
  }
  return null;
}

/** `Order.totalCents` → `Order`; `totalCents` → `totalCents` (no dot). */
function stripField(identity: string): string {
  const lastDot = identity.lastIndexOf('.');
  return lastDot < 0 ? identity : identity.slice(0, lastDot);
}

/** `Order.totalCents` → `totalCents`; `totalCents` → `totalCents`. */
function lastField(identity: string): string {
  const lastDot = identity.lastIndexOf('.');
  return lastDot < 0 ? identity : identity.slice(lastDot + 1);
}
