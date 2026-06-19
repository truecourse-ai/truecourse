import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { initParsers, parseFile } from '../../packages/analyzer/src/index.js';
import { extractFallbacksFromFile } from '../../packages/contract-verifier/src/extractor/fallback/ts-fallbacks.js';
import { extractPyFallbacksFromFile } from '../../packages/contract-verifier/src/extractor/fallback/py-fallbacks.js';
import { extractCsFallbacksFromFile } from '../../packages/contract-verifier/src/extractor/fallback/cs-fallbacks.js';
import { extractFallbacksFromDir } from '../../packages/contract-verifier/src/extractor/fallback/index.js';
import type { ExtractedFallback } from '../../packages/contract-verifier/src/extractor/fallback/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '../fixtures/fallback');

beforeAll(async () => {
  await initParsers();
});

function extract(source: string, filePath = '/test/x.ts'): ExtractedFallback[] {
  const tree = parseFile(filePath, source, 'typescript');
  const rules = extractFallbacksFromFile(filePath, source, tree);
  tree.delete();
  return rules;
}

function byField(rules: ExtractedFallback[], field: string): ExtractedFallback | undefined {
  return rules.find((r) => r.contract.target.field === field);
}

describe('Fallback code extractor', () => {
  it('derives every fallback from the realistic reservation-service fixture', () => {
    const fp = path.join(FIXTURE_DIR, 'reservation-service.ts');
    const source = fs.readFileSync(fp, 'utf-8');
    const rules = extract(source, fp);

    // currency, timezone, partySize, locale, notifyGuest
    expect(rules.map((r) => r.contract.target.field).sort()).toEqual([
      'currency',
      'locale',
      'notifyGuest',
      'partySize',
      'timezone',
    ]);

    // string `??` default
    expect(byField(rules, 'currency')!.contract).toEqual({
      target: { field: 'currency' },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'string', value: 'USD' },
    });

    // identifier `??` default (named constant)
    expect(byField(rules, 'timezone')!.contract.defaultValue).toEqual({
      kind: 'identifier',
      ref: 'DEFAULT_TIMEZONE',
    });

    // numeric `??` default
    expect(byField(rules, 'partySize')!.contract.defaultValue).toEqual({
      kind: 'number',
      value: 2,
    });

    // default-parameter fallback fires on absence
    expect(byField(rules, 'locale')!.contract).toEqual({
      target: { field: 'locale' },
      trigger: 'absent',
      defaultValue: { kind: 'string', value: 'en-US' },
    });

    // guarded-assignment boolean fallback
    expect(byField(rules, 'notifyGuest')!.contract).toEqual({
      target: { field: 'notifyGuest' },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'boolean', value: true },
    });
  });

  it('extracts the same fallbacks via the directory dispatcher', async () => {
    const rules = await extractFallbacksFromDir(FIXTURE_DIR);
    expect(rules.map((r) => r.identity).sort()).toEqual([
      'currency.fallback',
      'locale.fallback',
      'notifyGuest.fallback',
      'partySize.fallback',
      'timezone.fallback',
    ]);
  });

  it('recognizes a plain `const v = x ?? DEFAULT` coalescing', () => {
    const rules = extract(`const tz = req.query.tz ?? "UTC";`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'tz' },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'string', value: 'UTC' },
    });
  });

  it('derives the trigger from the guard operator', () => {
    // `=== null` strict → pure null trigger
    const nullGuard = extract(`function f(x) { if (x === null) { x = 0; } }`);
    expect(nullGuard[0].contract.trigger).toBe('null');
    // `=== undefined` strict → absent trigger
    const undefGuard = extract(`function f(x) { if (x === undefined) { x = 0; } }`);
    expect(undefGuard[0].contract.trigger).toBe('absent');
    // `== null` loose → nullish (either)
    const looseGuard = extract(`function f(x) { if (x == null) { x = 0; } }`);
    expect(looseGuard[0].contract.trigger).toBe('null-or-absent');
  });

  it('skips a non-scalar `??` default (object literal)', () => {
    const rules = extract(`const opts = userOpts ?? { retries: 3 };`);
    expect(rules).toHaveLength(0);
  });

  it('skips a `= {}` container parameter default', () => {
    const rules = extract(`function f(opts = {}) { return opts; }`);
    expect(rules).toHaveLength(0);
  });

  it('skips a guarded branch that does not assign the guarded target', () => {
    const rules = extract(`function f(x, y) { if (x == null) { y = 1; } }`);
    expect(rules).toHaveLength(0);
  });

  it('ignores `?? undefined` (a no-op, not a fallback)', () => {
    const rules = extract(`const v = x ?? undefined;`);
    expect(rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: the same null/absent -> default coalescing, in Python syntax. `or`
// is the idiomatic `??` analogue; `is None` guards and default parameters
// round out the three shapes.
// ---------------------------------------------------------------------------

function extractPy(source: string, filePath = '/test/x.py'): ExtractedFallback[] {
  const tree = parseFile(filePath, source, 'python');
  const rules = extractPyFallbacksFromFile(filePath, source, tree);
  tree.delete();
  return rules;
}

describe('Fallback code extractor — Python', () => {
  it('recognizes an identifier `or` coalescing (the realistic preferences fallback)', () => {
    const rules = extractPy(`
def read_preferences(customer):
    loyalty_tier = customer.loyalty_tier or DEFAULT_LOYALTY_TIER
    return loyalty_tier
`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'loyalty_tier' },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' },
    });
    expect(rules[0].identity).toBe('loyalty_tier.fallback');
  });

  it('recognizes a string `or` default', () => {
    const rules = extractPy(`tz = req.query.tz or "UTC"`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'tz' },
      trigger: 'null-or-absent',
      defaultValue: { kind: 'string', value: 'UTC' },
    });
  });

  it('recognizes a default-parameter fallback (fires on absence)', () => {
    const rules = extractPy(`def build_locale(locale="en-US"):\n    return locale.lower()`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'locale' },
      trigger: 'absent',
      defaultValue: { kind: 'string', value: 'en-US' },
    });
  });

  it('derives the trigger from the guard operator', () => {
    // `is None` identity → pure null trigger
    const nullGuard = extractPy(`def f(x):\n    if x is None:\n        x = 0`);
    expect(nullGuard[0].contract.trigger).toBe('null');
    // `== None` loose → nullish (either)
    const looseGuard = extractPy(`def f(x):\n    if x == None:\n        x = 0`);
    expect(looseGuard[0].contract.trigger).toBe('null-or-absent');
  });

  it('recognizes a guarded boolean default', () => {
    const rules = extractPy(`def f(notify):\n    if notify is None:\n        notify = True`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'notify' },
      trigger: 'null',
      defaultValue: { kind: 'boolean', value: true },
    });
  });

  it('skips a non-scalar `or` default (dict literal)', () => {
    const rules = extractPy(`opts = user_opts or {"retries": 3}`);
    expect(rules).toHaveLength(0);
  });

  it('skips a `= {}` container parameter default', () => {
    const rules = extractPy(`def f(opts={}):\n    return opts`);
    expect(rules).toHaveLength(0);
  });

  it('skips a guarded branch that does not assign the guarded target', () => {
    const rules = extractPy(`def f(x, y):\n    if x is None:\n        y = 1`);
    expect(rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C#: the same null/absent -> default coalescing, in C# syntax. C# has no
// `undefined`, so `??`/`??=`/`== null`/`is null` are pure null checks; a
// defaulted parameter fires on absence.
// ---------------------------------------------------------------------------

function extractCs(source: string, filePath = '/test/x.cs'): ExtractedFallback[] {
  const tree = parseFile(filePath, source, 'csharp');
  const rules = extractCsFallbacksFromFile(filePath, source, tree);
  tree.delete();
  return rules;
}

describe('Fallback code extractor — C#', () => {
  it('derives every fallback from a realistic reservation-service method', () => {
    const rules = extractCs(`
public class ReservationService {
  public Reservation Create(ReservationInput input, string locale = "en-US") {
    var currency = input.Currency ?? "USD";
    var partySize = input.PartySize ?? 2;
    var timezone = input.Timezone ?? DefaultTimezone;
    if (input.NotifyGuest == null) { input.NotifyGuest = true; }
    return new Reservation();
  }
}`);
    expect(rules.map((r) => r.contract.target.field).sort()).toEqual([
      'Currency',
      'NotifyGuest',
      'PartySize',
      'Timezone',
      'locale',
    ]);
    // string `??` default — C# `??` fires on null only.
    expect(byField(rules, 'Currency')!.contract).toEqual({
      target: { field: 'Currency' },
      trigger: 'null',
      defaultValue: { kind: 'string', value: 'USD' },
    });
    // numeric `??` default
    expect(byField(rules, 'PartySize')!.contract.defaultValue).toEqual({ kind: 'number', value: 2 });
    // identifier `??` default (named constant)
    expect(byField(rules, 'Timezone')!.contract.defaultValue).toEqual({
      kind: 'identifier',
      ref: 'DefaultTimezone',
    });
    // default-parameter fallback fires on absence
    expect(byField(rules, 'locale')!.contract).toEqual({
      target: { field: 'locale' },
      trigger: 'absent',
      defaultValue: { kind: 'string', value: 'en-US' },
    });
    // guarded-assignment boolean fallback (`== null`)
    expect(byField(rules, 'NotifyGuest')!.contract).toEqual({
      target: { field: 'NotifyGuest' },
      trigger: 'null',
      defaultValue: { kind: 'boolean', value: true },
    });
  });

  it('recognizes a `??=` coalescing assignment', () => {
    const rules = extractCs(`class C { void M(string region) { region ??= "us-east"; } }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'region' },
      trigger: 'null',
      defaultValue: { kind: 'string', value: 'us-east' },
    });
  });

  it('recognizes an `is null` guard', () => {
    const rules = extractCs(`class C { void M(Input input) { if (input.Tier is null) { input.Tier = "bronze"; } } }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].contract).toEqual({
      target: { field: 'Tier' },
      trigger: 'null',
      defaultValue: { kind: 'string', value: 'bronze' },
    });
  });

  it('skips a non-scalar `??` default (object initializer)', () => {
    const rules = extractCs(`class C { void M(Opts o) { var x = o ?? new Options { Retries = 3 }; } }`);
    expect(rules).toHaveLength(0);
  });

  it('skips a guarded branch that does not assign the guarded target', () => {
    const rules = extractCs(`class C { void M(string x, string y) { if (x == null) { y = "1"; } } }`);
    expect(rules).toHaveLength(0);
  });
});
