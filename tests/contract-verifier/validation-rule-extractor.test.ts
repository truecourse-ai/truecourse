import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractValidationRulesFromFile } from '../../packages/contract-verifier/src/extractor/validation-rule/ts-validation-rules.js';
import { extractPyValidationRulesFromFile } from '../../packages/contract-verifier/src/extractor/validation-rule/py-validation-rules.js';
import { extractValidationRulesFromDir } from '../../packages/contract-verifier/src/extractor/validation-rule/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '../fixtures/validation-rule');

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/x.ts') {
  const tree = parseFile(filePath, source, 'typescript');
  const rules = extractValidationRulesFromFile(filePath, source, tree);
  tree.delete();
  return rules;
}

describe('ValidationRule code extractor', () => {
  it('derives a required-when contract from the realistic booking-service fixture', () => {
    const fp = path.join(FIXTURE_DIR, 'booking-service.ts');
    const source = fs.readFileSync(fp, 'utf-8');
    const rules = extract(source, fp);

    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: 'cancellationReason',
      when: {
        kind: 'eq',
        column: { table: 'eventType', column: 'requiresCancellationReason' },
        value: { kind: 'string', value: 'MANDATORY' },
      },
      actor: 'host',
      effect: 'required',
      onViolation: { status: 400, errorCode: 'cancellation_reason_required' },
    });
    expect(rules[0].identity).toBe(
      'eventType.requiresCancellationReason.required-when.cancellationReason',
    );
  });

  it('extracts the same contract via the directory dispatcher', async () => {
    const rules = await extractValidationRulesFromDir(FIXTURE_DIR);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.target).toBe('cancellationReason');
    expect(rules[0].contract.effect).toBe('required');
  });

  it('recognizes the guard without an actor clause', () => {
    const rules = extract(`
      function guard(settings, reason) {
        if (settings.requiresNote === 'YES' && !reason) {
          throw new Error('note_required');
        }
      }
    `);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.actor).toBeUndefined();
    expect(rules[0].contract.target).toBe('reason');
    expect(rules[0].contract.when).toEqual({
      kind: 'eq',
      column: { table: 'settings', column: 'requiresNote' },
      value: { kind: 'string', value: 'YES' },
    });
  });

  it('handles the x == null missing form and a numeric throw status', () => {
    const rules = extract(`
      function guard(config, role, comment) {
        if (config.commentPolicy === 'REQUIRED' && role === 'admin' && comment == null) {
          throw new HttpError(422, 'comment_required');
        }
      }
    `);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.target).toBe('comment');
    expect(rules[0].contract.actor).toBe('admin');
    expect(rules[0].contract.onViolation).toEqual({ status: 422, errorCode: 'comment_required' });
  });

  it('derives a typed predicate from a non-eq setting comparison', () => {
    const rules = extract(`
      function guard(plan, field) {
        if (plan.seatCount > 10 && !field) {
          throw new Error('field_required');
        }
      }
    `);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.when).toEqual({
      kind: 'gt',
      column: { table: 'plan', column: 'seatCount' },
      value: { kind: 'number', value: 10 },
    });
  });

  it('skips a branch that does not enforce (no throw / error-return)', () => {
    const rules = extract(`
      function noGuard(settings, reason) {
        if (settings.requiresNote === 'YES' && !reason) {
          reason = 'n/a';
        }
      }
    `);
    expect(rules).toHaveLength(0);
  });

  it('skips a branch with no setting predicate', () => {
    const rules = extract(`
      function noSetting(reason) {
        if (!reason) {
          throw new Error('reason_required');
        }
      }
    `);
    expect(rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: the same required-when guard shape, in Python syntax. The extractor
// is language-general — both languages produce identical contracts.
// ---------------------------------------------------------------------------

function extractPy(source: string, filePath = '/test/x.py') {
  const tree = parseFile(filePath, source, 'python');
  const rules = extractPyValidationRulesFromFile(filePath, source, tree);
  tree.delete();
  return rules;
}

describe('ValidationRule code extractor — Python', () => {
  it('derives a required-when contract from the realistic preferences guard', () => {
    const rules = extractPy(`
def validate_downgrade(customer, actor, downgrade_reason):
    if customer.loyalty_tier == "gold" and actor == "customer" and not downgrade_reason:
        raise PreferenceValidationError("downgrade_reason_required", "reason required")
`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: 'downgrade_reason',
      when: {
        kind: 'eq',
        column: { table: 'customer', column: 'loyalty_tier' },
        value: { kind: 'string', value: 'gold' },
      },
      actor: 'customer',
      effect: 'required',
      onViolation: { status: 400, errorCode: 'downgrade_reason_required' },
    });
    expect(rules[0].identity).toBe('customer.loyalty_tier.required-when.downgrade_reason');
  });

  it('recognizes the guard without an actor clause', () => {
    const rules = extractPy(`
def guard(settings, reason):
    if settings.requires_note == "YES" and not reason:
        raise Exception("note_required")
`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.actor).toBeUndefined();
    expect(rules[0].contract.target).toBe('reason');
    expect(rules[0].contract.when).toEqual({
      kind: 'eq',
      column: { table: 'settings', column: 'requires_note' },
      value: { kind: 'string', value: 'YES' },
    });
  });

  it('handles the `x is None` missing form and a keyword status raise', () => {
    const rules = extractPy(`
def guard(config, role, comment):
    if config.comment_policy == "REQUIRED" and role == "admin" and comment is None:
        raise HTTPException(status_code=422, detail="comment_required")
`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.target).toBe('comment');
    expect(rules[0].contract.actor).toBe('admin');
    expect(rules[0].contract.onViolation).toEqual({ status: 422, errorCode: 'comment_required' });
  });

  it('derives a typed predicate from a non-eq setting comparison', () => {
    const rules = extractPy(`
def guard(plan, field):
    if plan.seat_count > 10 and not field:
        raise Exception("field_required")
`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract.when).toEqual({
      kind: 'gt',
      column: { table: 'plan', column: 'seat_count' },
      value: { kind: 'number', value: 10 },
    });
  });

  it('skips a branch that does not enforce (no raise / error-return)', () => {
    const rules = extractPy(`
def no_guard(settings, reason):
    if settings.requires_note == "YES" and not reason:
        reason = "n/a"
`);
    expect(rules).toHaveLength(0);
  });

  it('skips a branch with no setting predicate', () => {
    const rules = extractPy(`
def no_setting(reason):
    if not reason:
        raise Exception("reason_required")
`);
    expect(rules).toHaveLength(0);
  });
});
