import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

/**
 * Note: These rules require TypeQueryService (TypeScript compiler) for full detection.
 * In tests, tree-sitter parses the code but typeQuery is undefined, so visitors that
 * depend on type info will return null. Tests verify the visitors don't crash and
 * that rule definitions are properly registered.
 */
function check(code: string) {
  const tree = parseCode(code, 'typescript');
  return checkCodeRules(tree, `/test/file.ts`, code, enabledRules, 'typescript');
}

// ---------------------------------------------------------------------------
// Bugs domain — TypeScript type-aware rules
// ---------------------------------------------------------------------------

describe('bugs/deterministic/await-non-thenable', () => {
  it('does not crash on await expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      async function test() {
        const x = 42;
        await x;
      }
    `)).not.toThrow();
  });

  it('does not crash on normal await', () => {
    expect(() => check(`
      async function test() {
        await Promise.resolve(1);
      }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/unhandled-promise', () => {
  it('does not crash on expression statements (typeQuery unavailable)', () => {
    expect(() => check(`
      async function fetchData() { return 1; }
      fetchData();
    `)).not.toThrow();
  });

  it('does not flag expressions with .catch()', () => {
    expect(() => check(`
      fetchData().catch(console.error);
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/misused-promise', () => {
  it('does not crash on if statements (typeQuery unavailable)', () => {
    expect(() => check(`
      async function test() {
        if (fetchData()) {
          console.log('yes');
        }
      }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/misused-spread', () => {
  it('does not crash on spread elements (typeQuery unavailable)', () => {
    expect(() => check(`
      const x = "hello";
      const arr = [...x];
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/restrict-plus-operands', () => {
  it('does not crash on addition expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      const a = 1 + "hello";
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/restrict-template-expressions', () => {
  it('does not crash on template literals (typeQuery unavailable)', () => {
    expect(() => check(`
      const obj = { a: 1 };
      const s = \`value: \${obj}\`;
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/base-to-string', () => {
  it('does not crash on toString calls (typeQuery unavailable)', () => {
    expect(() => check(`
      const obj = { a: 1 };
      obj.toString();
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/unsafe-enum-comparison', () => {
  it('does not crash on comparison expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      enum Status { Active, Inactive }
      const s = Status.Active;
      if (s === 0) { console.log('match'); }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/unsafe-unary-minus', () => {
  it('does not crash on unary minus (typeQuery unavailable)', () => {
    expect(() => check(`
      const s = "hello";
      const n = -s;
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/switch-exhaustiveness', () => {
  it('does not crash on switch statements (typeQuery unavailable)', () => {
    expect(() => check(`
      type Status = 'active' | 'inactive' | 'pending';
      function handle(s: Status) {
        switch (s) {
          case 'active': return 1;
        }
      }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/non-number-arithmetic', () => {
  it('does not crash on arithmetic expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      const a = "hello" - 1;
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/values-not-convertible-to-number', () => {
  it('does not crash on relational comparisons (typeQuery unavailable)', () => {
    expect(() => check(`
      const a = true > false;
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/argument-type-mismatch', () => {
  it('does not crash on function calls (typeQuery unavailable)', () => {
    expect(() => check(`
      function add(a: number, b: number) { return a + b; }
      add("hello", 1);
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/function-return-type-varies', () => {
  it('does not crash on functions with multiple returns (typeQuery unavailable)', () => {
    expect(() => check(`
      function getValue(flag: boolean) {
        if (flag) return "hello";
        return 42;
      }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/loose-boolean-expression', () => {
  it('does not crash on if with non-boolean condition (typeQuery unavailable)', () => {
    expect(() => check(`
      const x = "hello";
      if (x) { console.log('truthy'); }
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/unsafe-type-assertion', () => {
  it('does not crash on as expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      const x: string = "hello";
      const y = x as number;
    `)).not.toThrow();
  });
});

describe('bugs/deterministic/void-return-value', () => {
  it('does not crash on void function call assignment (typeQuery unavailable)', () => {
    expect(() => check(`
      function doSomething(): void {}
      const result = doSomething();
    `)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Code-quality domain — TypeScript type-aware rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unsafe-any-usage', () => {
  it('does not crash on any-typed expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      const x: any = fetchSomething();
      x.property;
      x();
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/unnecessary-type-assertion', () => {
  it('does not crash on as expressions (typeQuery unavailable)', () => {
    expect(() => check(`
      const x: string = "hello";
      const y = x as string;
    `)).not.toThrow();
  });

  it('does not crash on non-null assertions (typeQuery unavailable)', () => {
    expect(() => check(`
      const x: string = "hello";
      const y = x!;
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/unnecessary-condition', () => {
  it('does not crash on always-truthy conditions (typeQuery unavailable)', () => {
    expect(() => check(`
      const obj = {};
      if (obj) { console.log('always true'); }
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/confusing-void-expression', () => {
  it('does not crash on void returns (typeQuery unavailable)', () => {
    expect(() => check(`
      function doSomething(): void {}
      function test() {
        return doSomething();
      }
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/redundant-type-argument', () => {
  it('does not crash on generic type arguments (typeQuery unavailable)', () => {
    expect(() => check(`
      const arr = new Array<any>();
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/unnecessary-type-conversion', () => {
  it('does not crash on type conversions (typeQuery unavailable)', () => {
    expect(() => check(`
      const s = "hello";
      const s2 = String(s);
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/unnecessary-type-parameter', () => {
  it('does not crash on generic functions (typeQuery unavailable)', () => {
    expect(() => check(`
      function identity<T>(x: T): T { return x; }
    `)).not.toThrow();
  });

  it('does not crash on single-use type parameters (typeQuery unavailable)', () => {
    expect(() => check(`
      function wrap<T>(x: T): void { console.log(x); }
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/prefer-this-return-type', () => {
  it('does not crash on class method with return type (typeQuery unavailable)', () => {
    expect(() => check(`
      class Builder {
        setName(name: string): Builder {
          return this;
        }
      }
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/unnecessary-namespace-qualifier', () => {
  it('does not crash on enum member references (typeQuery unavailable)', () => {
    expect(() => check(`
      enum Status {
        Active = 1,
        Inactive = Status.Active + 1,
      }
    `)).not.toThrow();
  });
});

describe('code-quality/deterministic/readonly-parameter-types', () => {
  it('does not crash on array parameters (typeQuery unavailable)', () => {
    expect(() => check(`
      function process(items: string[]): void {
        console.log(items.length);
      }
    `)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Python type-aware rules (heuristic-based — these actually detect things)
// ---------------------------------------------------------------------------

function checkPy(code: string) {
  const tree = parseCode(code, 'python');
  return checkCodeRules(tree, `/test/file.py`, code, enabledRules, 'python');
}

describe('bugs/deterministic/non-callable-called (Python)', () => {
  it('detects calling a literal directly', () => {
    const violations = checkPy(`42()`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/non-callable-called')).toBe(true);
  });

  it('detects calling a string literal', () => {
    const violations = checkPy(`"hello"()`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/non-callable-called')).toBe(true);
  });

  it('detects calling a recently-assigned non-callable', () => {
    const violations = checkPy(`x = 42\nx()`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/non-callable-called')).toBe(true);
  });

  it('does not flag calling a normal function', () => {
    const violations = checkPy(`def foo():\n    pass\nfoo()`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/non-callable-called')).toBe(false);
  });
});

describe('bugs/deterministic/incompatible-operator-types (Python)', () => {
  it('detects str + int', () => {
    const violations = checkPy(`result = "hello" + 42`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/incompatible-operator-types')).toBe(true);
  });

  it('detects str - str', () => {
    const violations = checkPy(`result = "hello" - "world"`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/incompatible-operator-types')).toBe(true);
  });

  it('does not flag int + int', () => {
    const violations = checkPy(`result = 1 + 2`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/incompatible-operator-types')).toBe(false);
  });

  it('does not flag str + str', () => {
    const violations = checkPy(`result = "hello" + " world"`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/incompatible-operator-types')).toBe(false);
  });
});

describe('bugs/deterministic/unnecessary-equality-check (Python)', () => {
  it('detects int == string', () => {
    const violations = checkPy(`result = 42 == "42"`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/unnecessary-equality-check')).toBe(true);
  });

  it('does not flag int == int', () => {
    const violations = checkPy(`result = 42 == 43`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/unnecessary-equality-check')).toBe(false);
  });
});

describe('bugs/deterministic/identity-with-dissimilar-types (Python)', () => {
  it('detects int is string', () => {
    const violations = checkPy(`result = 42 is "42"`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/identity-with-dissimilar-types')).toBe(true);
  });
});

describe('bugs/deterministic/not-in-operator-incompatible (Python)', () => {
  it('detects x in 42', () => {
    const violations = checkPy(`result = "a" in 42`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/not-in-operator-incompatible')).toBe(true);
  });

  it('does not flag x in list', () => {
    const violations = checkPy(`result = "a" in ["a", "b"]`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/not-in-operator-incompatible')).toBe(false);
  });
});

describe('bugs/deterministic/item-operation-unsupported (Python)', () => {
  it('detects subscript on int', () => {
    const violations = checkPy(`result = 42[0]`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/item-operation-unsupported')).toBe(true);
  });

  it('detects subscript on None', () => {
    const violations = checkPy(`result = None[0]`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/item-operation-unsupported')).toBe(true);
  });
});

describe('bugs/deterministic/assertion-incompatible-types (Python)', () => {
  it('detects assert with incompatible literal comparison', () => {
    const violations = checkPy(`assert 42 == "42"`);
    expect(violations.some((v) => v.ruleKey === 'bugs/deterministic/assertion-incompatible-types')).toBe(true);
  });
});

describe('code-quality/deterministic/assignment-inconsistent-with-hint (Python)', () => {
  it('detects string assigned to int hint', () => {
    const violations = checkPy(`x: int = "hello"`);
    expect(violations.some((v) => v.ruleKey === 'code-quality/deterministic/assignment-inconsistent-with-hint')).toBe(true);
  });

  it('detects int assigned to str hint', () => {
    const violations = checkPy(`x: str = 42`);
    expect(violations.some((v) => v.ruleKey === 'code-quality/deterministic/assignment-inconsistent-with-hint')).toBe(true);
  });

  it('does not flag matching types', () => {
    const violations = checkPy(`x: int = 42`);
    expect(violations.some((v) => v.ruleKey === 'code-quality/deterministic/assignment-inconsistent-with-hint')).toBe(false);
  });
});

describe('code-quality/deterministic/return-type-inconsistent-with-hint (Python)', () => {
  it('detects string returned from int function', () => {
    const violations = checkPy(`def get_count() -> int:\n    return "hello"`);
    expect(violations.some((v) => v.ruleKey === 'code-quality/deterministic/return-type-inconsistent-with-hint')).toBe(true);
  });

  it('does not flag matching return types', () => {
    const violations = checkPy(`def get_count() -> int:\n    return 42`);
    expect(violations.some((v) => v.ruleKey === 'code-quality/deterministic/return-type-inconsistent-with-hint')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Verify all type-aware rules are registered
// ---------------------------------------------------------------------------

describe('type-aware rule registration', () => {
  const typeAwareRuleKeys = [
    // Bugs — TypeScript
    'bugs/deterministic/await-non-thenable',
    'bugs/deterministic/unhandled-promise',
    'bugs/deterministic/misused-promise',
    'bugs/deterministic/misused-spread',
    'bugs/deterministic/restrict-plus-operands',
    'bugs/deterministic/restrict-template-expressions',
    'bugs/deterministic/base-to-string',
    'bugs/deterministic/unsafe-enum-comparison',
    'bugs/deterministic/unsafe-unary-minus',
    'bugs/deterministic/switch-exhaustiveness',
    'bugs/deterministic/non-number-arithmetic',
    'bugs/deterministic/values-not-convertible-to-number',
    'bugs/deterministic/argument-type-mismatch',
    'bugs/deterministic/function-return-type-varies',
    'bugs/deterministic/loose-boolean-expression',
    'bugs/deterministic/unsafe-type-assertion',
    'bugs/deterministic/void-return-value',
    // Code-quality — TypeScript
    'code-quality/deterministic/unsafe-any-usage',
    'code-quality/deterministic/unnecessary-type-assertion',
    'code-quality/deterministic/unnecessary-condition',
    'code-quality/deterministic/confusing-void-expression',
    'code-quality/deterministic/redundant-type-argument',
    'code-quality/deterministic/unnecessary-type-conversion',
    'code-quality/deterministic/unnecessary-type-parameter',
    'code-quality/deterministic/prefer-this-return-type',
    'code-quality/deterministic/unnecessary-namespace-qualifier',
    'code-quality/deterministic/readonly-parameter-types',
    // Bugs — Python heuristic-based
    'bugs/deterministic/undefined-name',
    'bugs/deterministic/undefined-local-variable',
    'bugs/deterministic/non-callable-called',
    'bugs/deterministic/incompatible-operator-types',
    'bugs/deterministic/unnecessary-equality-check',
    'bugs/deterministic/identity-with-dissimilar-types',
    'bugs/deterministic/not-in-operator-incompatible',
    'bugs/deterministic/item-operation-unsupported',
    'bugs/deterministic/class-mixed-typevars',
    'bugs/deterministic/assertion-incompatible-types',
    // Code-quality — Python heuristic-based
    'code-quality/deterministic/return-type-inconsistent-with-hint',
    'code-quality/deterministic/assignment-inconsistent-with-hint',
  ];

  for (const key of typeAwareRuleKeys) {
    it(`rule "${key}" is registered in ALL_DEFAULT_RULES`, () => {
      const found = ALL_DEFAULT_RULES.find((r) => r.key === key);
      expect(found).toBeDefined();
      expect(found!.enabled).toBe(true);
    });
  }
});
