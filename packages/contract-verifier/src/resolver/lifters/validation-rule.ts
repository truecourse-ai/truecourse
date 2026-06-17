/**
 * Lift `validation-rule <id> { … }` into a typed ValidationRuleContract.
 *
 * A validation-rule is a standalone conditional field-requiredness rule:
 * "input <target> is required | optional | forbidden WHEN <predicate over a
 * setting/entity field> [and actor is <role>]". It generalizes an operation
 * precondition into a reusable rule not bound to one HTTP operation.
 *
 * Syntax:
 *
 *   validation-rule cancellation.reason-required {
 *     origin SPEC.md "Cancellation" 40..52   // read by the resolver
 *     target cancellationReason
 *     when eq eventType.requiresCancellationReason "MANDATORY"
 *     actor host
 *     effect required
 *     on-violation { status 400 error-code reason_required }
 *   }
 *
 * The `when` clause reuses the QueryRule predicate vocabulary verbatim
 * (`eq`/`neq`/`in`/`not-in`/`is-null`/`is-not-null`/`gt`/`gte`/`lt`/`lte`/
 * `between`/`like`/`ilike`/`raw`/column-compare). The setting field is a
 * `table.column` ident split on the last dot, same as query-rule columns.
 */

import type { StatementNode } from '../../parser/index.js';
import type { Predicate, ValidationRuleContract } from '../../types/index.js';
import { liftPredicateStmt } from './query-rule.js';

const VALID_EFFECTS = new Set<ValidationRuleContract['effect']>([
  'required',
  'optional',
  'forbidden',
]);

export function liftValidationRule(body: StatementNode[]): ValidationRuleContract {
  let target = '';
  let actor: string | undefined;
  let effect: ValidationRuleContract['effect'] = 'required';
  let when: Predicate | undefined;
  let onViolation: ValidationRuleContract['onViolation'];

  for (const stmt of body) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    const k = h[0].value;

    if (k === 'target' && h[1]?.kind === 'ident') {
      target = h[1].value;
      continue;
    }
    if (k === 'actor' && h[1]?.kind === 'ident') {
      actor = h[1].value;
      continue;
    }
    if (k === 'effect' && h[1]?.kind === 'ident') {
      if (VALID_EFFECTS.has(h[1].value as ValidationRuleContract['effect'])) {
        effect = h[1].value as ValidationRuleContract['effect'];
      }
      continue;
    }
    if (k === 'when') {
      // The remaining head tokens form a predicate line (`when eq col val`);
      // re-lift them through the shared query-rule predicate parser by
      // synthesizing a predicate statement from the tail.
      const predStmt: StatementNode = { head: h.slice(1), loc: stmt.loc };
      const p = liftPredicateStmt(predStmt);
      if (p) when = p;
      continue;
    }
    if (k === 'on-violation' && stmt.block) {
      onViolation = liftOnViolation(stmt.block);
      continue;
    }
  }

  return {
    target,
    // A rule with no parseable condition is degenerate but never dropped:
    // surface it as an opaque `raw` predicate so downstream review sees it.
    when: when ?? { kind: 'raw', sql: '' },
    actor,
    effect,
    onViolation,
  };
}

function liftOnViolation(block: StatementNode[]): ValidationRuleContract['onViolation'] {
  let status = 0;
  let errorCode = '';
  for (const stmt of block) {
    const h = stmt.head;
    if (h.length === 0 || h[0].kind !== 'ident') continue;
    if (h[0].value === 'status' && h[1]?.kind === 'number') {
      status = h[1].value;
      continue;
    }
    if (h[0].value === 'error-code' && h[1]?.kind === 'ident') {
      errorCode = h[1].value;
      continue;
    }
  }
  if (status === 0 && errorCode === '') return undefined;
  return { status, errorCode };
}
