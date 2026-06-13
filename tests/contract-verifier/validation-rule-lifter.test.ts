import { describe, it, expect } from 'vitest';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ValidationRuleContract } from '../../packages/contract-verifier/src/types/index.js';

function lift(src: string): ValidationRuleContract {
  const file = parseFile('vr.tc', src);
  const r = resolve([file]);
  if (r.errors.length > 0) {
    throw new Error(`resolve errors: ${r.errors.map((e) => e.message).join('; ')}`);
  }
  const first = r.index.values().next().value!;
  expect(first.ref.type).toBe('ValidationRule');
  return first.contract as ValidationRuleContract;
}

describe('ValidationRule lifter — .tc grammar', () => {
  it('lifts a full required-when rule with actor + on-violation', () => {
    const c = lift(`
validation-rule booking.reason-required-when-mandatory {
  origin SPEC.md "Cancellation policy" 40..52
  target cancellationReason
  when eq eventType.requiresCancellationReason "MANDATORY"
  actor host
  effect required
  on-violation {
    status 400
    error-code reason_required
  }
}
`);
    expect(c).toEqual({
      target: 'cancellationReason',
      when: {
        kind: 'eq',
        column: { table: 'eventType', column: 'requiresCancellationReason' },
        value: { kind: 'string', value: 'MANDATORY' },
      },
      actor: 'host',
      effect: 'required',
      onViolation: { status: 400, errorCode: 'reason_required' },
    });
  });

  it('defaults effect to required and omits optional actor/on-violation', () => {
    const c = lift(`
validation-rule minimal {
  target reason
  when eq settings.policy "STRICT"
}
`);
    expect(c.effect).toBe('required');
    expect(c.actor).toBeUndefined();
    expect(c.onViolation).toBeUndefined();
    expect(c.target).toBe('reason');
    expect(c.when).toEqual({
      kind: 'eq',
      column: { table: 'settings', column: 'policy' },
      value: { kind: 'string', value: 'STRICT' },
    });
  });

  it('honors forbidden and optional effects', () => {
    expect(
      lift(`validation-rule a { target x when eq s.flag true effect forbidden }`).effect,
    ).toBe('forbidden');
    expect(
      lift(`validation-rule b { target x when eq s.flag true effect optional }`).effect,
    ).toBe('optional');
  });

  it('reuses the query-rule predicate vocabulary for the when clause', () => {
    // in / not-in / is-null / neq / between all parse through the shared
    // predicate algebra.
    expect(
      lift(`validation-rule c { target x when in s.tier ["gold", "platinum"] effect required }`)
        .when,
    ).toEqual({
      kind: 'in',
      column: { table: 's', column: 'tier' },
      values: [
        { kind: 'string', value: 'gold' },
        { kind: 'string', value: 'platinum' },
      ],
    });

    expect(
      lift(`validation-rule d { target x when is-not-null account.verifiedAt effect required }`)
        .when,
    ).toEqual({
      kind: 'is-not-null',
      column: { table: 'account', column: 'verifiedAt' },
    });

    expect(
      lift(`validation-rule e { target x when neq order.status "DRAFT" effect required }`).when,
    ).toEqual({
      kind: 'neq',
      column: { table: 'order', column: 'status' },
      value: { kind: 'string', value: 'DRAFT' },
    });
  });

  it('preserves an unrecognized when predicate as raw (never dropped)', () => {
    const c = lift(`
validation-rule f {
  target x
  when overlaps booking.range "[a, b)"
  effect required
}
`);
    expect(c.when.kind).toBe('raw');
    expect((c.when as { sql: string }).sql).toContain('overlaps');
  });
});
