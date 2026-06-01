/**
 * Lift `constant <name> { type ... expected-value ... }` into a
 * typed NamedConstantContract.
 *
 * Grammar:
 *
 *   constant LLM_MODEL {
 *     origin SPEC.md "Tech Stack" 100..110
 *     type string
 *     expected-value "claude-sonnet-4-6"
 *   }
 *
 *   constant TIER_WEIGHTS {
 *     type object
 *     expected-value {
 *       Critical: 3
 *       Significant: 2
 *       Noticeable: 1
 *       Moderate: 1
 *       Minor: 1
 *       "Out of Tech Control": 0.5
 *     }
 *   }
 *
 *   constant ALLOWED_STATUS {
 *     type array
 *     expected-value [active, pending, archived]
 *   }
 *
 * Type defaults to `string` when not given (most common case).
 */

import type { StatementNode, HeadToken } from '../../parser/index.js';
import type { NamedConstantContract } from '../../types/index.js';

const VALID_TYPES = new Set<NamedConstantContract['type']>([
  'string', 'number', 'boolean', 'object', 'array',
]);

export function liftNamedConstant(body: StatementNode[]): NamedConstantContract {
  let type: NamedConstantContract['type'] = 'string';
  let expectedValue: unknown = '';

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'type' && h[1]?.kind === 'ident') {
      if (VALID_TYPES.has(h[1].value as NamedConstantContract['type'])) {
        type = h[1].value as NamedConstantContract['type'];
      }
      continue;
    }
    if (k === 'expected-value') {
      // Either: inline value (one head token after the keyword)
      //   expected-value "claude-sonnet-4-6"
      //   expected-value 42
      //   expected-value [a, b, c]
      // Or: block form (no inline value, body has property declarations)
      //   expected-value {
      //     Critical: 3
      //     ...
      //   }
      if (h.length >= 2) {
        expectedValue = parseInlineValue(h[1]);
      } else if (stmt.block) {
        expectedValue = parseObjectBlock(stmt.block);
      }
      continue;
    }
  }

  return { type, expectedValue };
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

function parseInlineValue(t: HeadToken): unknown {
  switch (t.kind) {
    case 'string': return t.value;
    case 'number': return t.value;
    case 'ident': {
      const v = t.value;
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (v === 'null') return null;
      // Bare ident is treated as a string (covers `expected-value foo`,
      // common for short identifier values like enum-member references).
      return v;
    }
    case 'list': {
      const out: unknown[] = [];
      for (const item of t.items) out.push(parseInlineValue(item));
      return out;
    }
    default:
      return null;
  }
}

/**
 * Parse an `expected-value {}` block of `key: value` lines. Each line
 * has head form: `<ident-or-string> ':' <value>`. The parser already
 * produces the `:` as an `op` token with value `:`.
 */
function parseObjectBlock(stmts: StatementNode[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const stmt of stmts) {
    const h = stmt.head;
    if (h.length < 3) continue;
    const keyToken = h[0];
    const colon = h[1];
    if (colon.kind !== 'op' || colon.value !== ':') continue;
    let key = '';
    if (keyToken.kind === 'ident') key = keyToken.value;
    else if (keyToken.kind === 'string') key = keyToken.value;
    else continue;
    // Remaining tokens form the value. For simple cases that's one
    // token; nested object literals would need recursive block
    // handling, which v1 doesn't support (use a flat object only).
    const value = parseInlineValue(h[2]);
    out[key] = value;
  }
  return out;
}
