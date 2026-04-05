import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language);
}

// ---------------------------------------------------------------------------
// JS/TS
// ---------------------------------------------------------------------------

describe('bugs/deterministic/empty-catch', () => {
  it('detects empty catch blocks', () => {
    const violations = check(`
      try { doSomething(); } catch (e) {}
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-catch');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Empty catch block');
  });

  it('does not flag catch blocks with statements', () => {
    const violations = check(`
      try { doSomething(); } catch (e) { console.error(e); }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-catch');
    expect(matches).toHaveLength(0);
  });

  it('flags catch blocks with only comments (no actual handling)', () => {
    const violations = check(`
      try { doSomething(); } catch (e) { /* intentionally empty */ }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-catch');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/empty-catch', () => {
  it('detects except with only pass', () => {
    const violations = check(`
try:
    do_something()
except Exception:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-catch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with handler', () => {
    const violations = check(`
try:
    do_something()
except Exception as e:
    logger.error(e)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-catch');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: bugs/deterministic/bare-except', () => {
  it('detects bare except clause', () => {
    const violations = check(`
try:
    do_something()
except:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except Exception', () => {
    const violations = check(`
try:
    do_something()
except Exception:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(0);
  });

  it('flags except BaseException', () => {
    const violations = check(`
try:
    do_something()
except BaseException:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with tuple of types', () => {
    const violations = check(`
try:
    do_something()
except (ValueError, TypeError):
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(0);
  });

  it('does not flag except with dotted attribute type', () => {
    const violations = check(`
import json
try:
    data = json.loads(text)
except json.JSONDecodeError:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: bugs/deterministic/mutable-default-arg', () => {
  it('detects list default', () => {
    const violations = check(`def foo(items=[]):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-default-arg');
    expect(matches).toHaveLength(1);
  });

  it('detects dict default', () => {
    const violations = check(`def foo(data={}):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-default-arg');
    expect(matches).toHaveLength(1);
  });

  it('does not flag None default', () => {
    const violations = check(`def foo(items=None):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });

  it('does not flag immutable defaults', () => {
    const violations = check(`def foo(x=5, name="default", flag=True):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: self-comparison
// ---------------------------------------------------------------------------

describe('bugs/deterministic/self-comparison', () => {
  it('detects x === x', () => {
    const violations = check(`const result = x === x;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(1);
  });

  it('detects x == x', () => {
    const violations = check(`if (y == y) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x === y', () => {
    const violations = check(`const result = x === y;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(0);
  });

  it('does not flag NaN === NaN (handled by no-self-compare)', () => {
    const violations = check(`const result = NaN === NaN;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: self-assignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/self-assignment', () => {
  it('detects x = x', () => {
    const violations = check(`x = x;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x = y', () => {
    const violations = check(`x = y;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-assignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: assignment-in-condition
// ---------------------------------------------------------------------------

describe('bugs/deterministic/assignment-in-condition', () => {
  it('detects if (x = 5)', () => {
    const violations = check(`if (x = 5) { console.log(x); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-in-condition');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if (x === 5)', () => {
    const violations = check(`if (x === 5) { console.log(x); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-in-condition');
    expect(matches).toHaveLength(0);
  });

  it('detects while (x = getNext())', () => {
    const violations = check(`while (x = getNext()) { process(x); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-in-condition');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: duplicate-case
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-case', () => {
  it('detects duplicate case values', () => {
    const violations = check(`
      switch (x) {
        case 1: break;
        case 2: break;
        case 1: break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-case');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique case values', () => {
    const violations = check(`
      switch (x) {
        case 1: break;
        case 2: break;
        case 3: break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-case');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: duplicate-keys
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-keys', () => {
  it('detects duplicate object keys', () => {
    const violations = check(`const obj = { a: 1, b: 2, a: 3 };`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-keys');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique keys', () => {
    const violations = check(`const obj = { a: 1, b: 2, c: 3 };`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-keys');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: all-branches-identical
// ---------------------------------------------------------------------------

describe('bugs/deterministic/all-branches-identical', () => {
  it('detects if/else with identical branches', () => {
    const violations = check(`
      if (condition) {
        doSomething();
      } else {
        doSomething();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/all-branches-identical');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if/else with different branches', () => {
    const violations = check(`
      if (condition) {
        doA();
      } else {
        doB();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/all-branches-identical');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: constant-condition
// ---------------------------------------------------------------------------

describe('bugs/deterministic/constant-condition', () => {
  it('detects if (true)', () => {
    const violations = check(`if (true) { doSomething(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(1);
  });

  it('detects if (false)', () => {
    const violations = check(`if (false) { doSomething(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(1);
  });

  it('does not flag while (true) — idiomatic infinite loop', () => {
    const violations = check(`while (true) { process(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal conditions', () => {
    const violations = check(`if (x > 5) { doSomething(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unreachable-code
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unreachable-code', () => {
  it('detects code after return', () => {
    const violations = check(`
      function foo() {
        return 1;
        console.log("unreachable");
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(1);
  });

  it('detects code after throw', () => {
    const violations = check(`
      function foo() {
        throw new Error("fail");
        console.log("unreachable");
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(1);
  });

  it('does not flag code before return', () => {
    const violations = check(`
      function foo() {
        console.log("reachable");
        return 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: no-self-compare
// ---------------------------------------------------------------------------

describe('bugs/deterministic/no-self-compare', () => {
  it('detects NaN === NaN', () => {
    const violations = check(`const bad = NaN === NaN;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-self-compare');
    expect(matches).toHaveLength(1);
  });

  it('detects x !== x pattern', () => {
    const violations = check(`const isNan = value !== value;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-self-compare');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x !== y', () => {
    const violations = check(`const result = a !== b;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-self-compare');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: self-comparison
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/self-comparison', () => {
  it('detects x == x', () => {
    const violations = check(`result = x == x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x == y', () => {
    const violations = check(`result = x == y`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: self-assignment
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/self-assignment', () => {
  it('detects x = x', () => {
    const violations = check(`x = x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x = y', () => {
    const violations = check(`x = y`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/self-assignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-keys
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-keys', () => {
  it('detects duplicate dict keys', () => {
    const violations = check(`d = {"a": 1, "b": 2, "a": 3}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-keys');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique dict keys', () => {
    const violations = check(`d = {"a": 1, "b": 2, "c": 3}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-keys');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-args
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-args', () => {
  it('detects duplicate parameter names', () => {
    const violations = check(`def foo(a, b, a):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-args');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique parameter names', () => {
    const violations = check(`def foo(a, b, c):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-args');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: all-branches-identical
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/all-branches-identical', () => {
  it('detects if/else with identical branches', () => {
    const violations = check(`
if condition:
    do_something()
else:
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/all-branches-identical');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if/else with different branches', () => {
    const violations = check(`
if condition:
    do_a()
else:
    do_b()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/all-branches-identical');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: constant-condition
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/constant-condition', () => {
  it('detects if True', () => {
    const violations = check(`
if True:
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(1);
  });

  it('detects if False', () => {
    const violations = check(`
if False:
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(1);
  });

  it('does not flag while True — idiomatic', () => {
    const violations = check(`
while True:
    process()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-condition');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: unreachable-code
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/unreachable-code', () => {
  it('detects code after return', () => {
    const violations = check(`
def foo():
    return 1
    print("unreachable")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(1);
  });

  it('detects code after raise', () => {
    const violations = check(`
def foo():
    raise ValueError("fail")
    print("unreachable")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(1);
  });

  it('does not flag code before return', () => {
    const violations = check(`
def foo():
    print("reachable")
    return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-code');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: duplicate-class-members
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-class-members', () => {
  it('detects duplicate method names', () => {
    const violations = check(`
      class Foo {
        bar() { return 1; }
        bar() { return 2; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-class-members');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique method names', () => {
    const violations = check(`
      class Foo {
        bar() { return 1; }
        baz() { return 2; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-class-members');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-class-members
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-class-members', () => {
  it('detects duplicate method names', () => {
    const violations = check(`
class Foo:
    def bar(self):
        return 1
    def bar(self):
        return 2
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-class-members');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique method names', () => {
    const violations = check(`
class Foo:
    def bar(self):
        return 1
    def baz(self):
        return 2
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-class-members');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: duplicate-else-if
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-else-if', () => {
  it('detects duplicate conditions in if/else if chain', () => {
    const violations = check(`
      if (x > 1) {
        a();
      } else if (x > 2) {
        b();
      } else if (x > 1) {
        c();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-else-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique conditions', () => {
    const violations = check(`
      if (x > 1) {
        a();
      } else if (x > 2) {
        b();
      } else if (x > 3) {
        c();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-else-if');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-else-if
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-else-if', () => {
  it('detects duplicate conditions in if/elif chain', () => {
    const violations = check(`
if x > 1:
    a()
elif x > 2:
    b()
elif x > 1:
    c()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-else-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique elif conditions', () => {
    const violations = check(`
if x > 1:
    a()
elif x > 2:
    b()
elif x > 3:
    c()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-else-if');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: duplicate-branches
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-branches', () => {
  it('detects if/else if with identical branch bodies', () => {
    const violations = check(`
      if (x > 1) {
        doA();
      } else if (x > 2) {
        doA();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-branches');
    expect(matches).toHaveLength(1);
  });

  it('does not flag different branch bodies', () => {
    const violations = check(`
      if (x > 1) {
        doA();
      } else if (x > 2) {
        doB();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-branches');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: invalid-typeof
// ---------------------------------------------------------------------------

describe('bugs/deterministic/invalid-typeof', () => {
  it('detects typeof compared to invalid string', () => {
    const violations = check(`if (typeof x === "strig") {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-typeof');
    expect(matches).toHaveLength(1);
  });

  it('does not flag valid typeof comparison', () => {
    const violations = check(`if (typeof x === "string") {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-typeof');
    expect(matches).toHaveLength(0);
  });

  it('detects "undefind" typo', () => {
    const violations = check(`if (typeof x === "undefind") {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-typeof');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: use-isnan
// ---------------------------------------------------------------------------

describe('bugs/deterministic/use-isnan', () => {
  it('detects x === NaN', () => {
    const violations = check(`if (x === NaN) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/use-isnan');
    expect(matches).toHaveLength(1);
  });

  it('detects NaN == y', () => {
    const violations = check(`const bad = NaN == y;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/use-isnan');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Number.isNaN(x)', () => {
    const violations = check(`if (Number.isNaN(x)) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/use-isnan');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: compare-neg-zero
// ---------------------------------------------------------------------------

describe('bugs/deterministic/compare-neg-zero', () => {
  it('detects x === -0', () => {
    const violations = check(`if (x === -0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/compare-neg-zero');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x === 0', () => {
    const violations = check(`if (x === 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/compare-neg-zero');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: loss-of-precision
// ---------------------------------------------------------------------------

describe('bugs/deterministic/loss-of-precision', () => {
  it('detects number exceeding safe integer range', () => {
    const violations = check(`const big = 9007199254740993;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loss-of-precision');
    expect(matches).toHaveLength(1);
  });

  it('does not flag safe integers', () => {
    const violations = check(`const safe = 9007199254740991;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loss-of-precision');
    expect(matches).toHaveLength(0);
  });

  it('does not flag BigInt literals', () => {
    const violations = check(`const big = 9007199254740993n;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loss-of-precision');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unsafe-negation
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unsafe-negation', () => {
  it('detects !a instanceof B', () => {
    const violations = check(`if (!a instanceof B) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-negation');
    expect(matches).toHaveLength(1);
  });

  it('does not flag !(a instanceof B)', () => {
    const violations = check(`if (!(a instanceof B)) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-negation');
    expect(matches).toHaveLength(0);
  });

  it('detects !a in B', () => {
    const violations = check(`if (!key in obj) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-negation');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unsafe-optional-chaining
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unsafe-optional-chaining', () => {
  it('detects (obj?.method)()', () => {
    const violations = check(`(obj?.method)();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-optional-chaining');
    expect(matches).toHaveLength(1);
  });

  it('does not flag obj?.method()', () => {
    const violations = check(`obj?.method();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-optional-chaining');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unsafe-finally
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unsafe-finally', () => {
  it('detects return in finally', () => {
    const violations = check(`
      function foo() {
        try {
          return 1;
        } finally {
          return 2;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(1);
  });

  it('detects throw in finally', () => {
    const violations = check(`
      function foo() {
        try {
          return 1;
        } finally {
          throw new Error("oops");
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(1);
  });

  it('does not flag finally without return/throw', () => {
    const violations = check(`
      function foo() {
        try {
          return 1;
        } finally {
          cleanup();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: unsafe-finally
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/unsafe-finally', () => {
  it('detects return in finally', () => {
    const violations = check(`
def foo():
    try:
        return 1
    finally:
        return 2
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(1);
  });

  it('detects raise in finally', () => {
    const violations = check(`
def foo():
    try:
        return 1
    finally:
        raise ValueError("oops")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(1);
  });

  it('does not flag finally without return/raise', () => {
    const violations = check(`
def foo():
    try:
        return 1
    finally:
        cleanup()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unsafe-finally');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: fallthrough-case
// ---------------------------------------------------------------------------

describe('bugs/deterministic/fallthrough-case', () => {
  it('detects case without break', () => {
    const violations = check(`
      switch (x) {
        case 1:
          doSomething();
        case 2:
          doOther();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fallthrough-case');
    expect(matches).toHaveLength(1);
  });

  it('does not flag case with break', () => {
    const violations = check(`
      switch (x) {
        case 1:
          doSomething();
          break;
        case 2:
          doOther();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fallthrough-case');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty case (intentional grouping)', () => {
    const violations = check(`
      switch (x) {
        case 1:
        case 2:
          doSomething();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fallthrough-case');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: for-direction
// ---------------------------------------------------------------------------

describe('bugs/deterministic/for-direction', () => {
  it('detects wrong direction: i-- with i < 10', () => {
    const violations = check(`for (let i = 0; i < 10; i--) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/for-direction');
    expect(matches).toHaveLength(1);
  });

  it('detects wrong direction: i++ with i > 0', () => {
    const violations = check(`for (let i = 10; i > 0; i++) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/for-direction');
    expect(matches).toHaveLength(1);
  });

  it('does not flag correct direction: i++ with i < 10', () => {
    const violations = check(`for (let i = 0; i < 10; i++) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/for-direction');
    expect(matches).toHaveLength(0);
  });

  it('does not flag correct direction: i-- with i > 0', () => {
    const violations = check(`for (let i = 10; i > 0; i--) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/for-direction');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: no-constructor-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/no-constructor-return', () => {
  it('detects return value in constructor', () => {
    const violations = check(`
      class Foo {
        constructor() {
          return { bad: true };
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-constructor-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag constructor without return value', () => {
    const violations = check(`
      class Foo {
        constructor() {
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-constructor-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty return in constructor', () => {
    const violations = check(`
      class Foo {
        constructor() {
          if (!valid) return;
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-constructor-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: no-setter-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/no-setter-return', () => {
  it('detects return value in setter', () => {
    const violations = check(`
      class Foo {
        set name(val) {
          this._name = val;
          return val;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-setter-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag setter without return value', () => {
    const violations = check(`
      class Foo {
        set name(val) {
          this._name = val;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-setter-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: no-promise-executor-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/no-promise-executor-return', () => {
  it('detects return value in Promise executor', () => {
    const violations = check(`
      const p = new Promise((resolve) => {
        return 42;
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-promise-executor-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag resolve() in Promise executor', () => {
    const violations = check(`
      const p = new Promise((resolve) => {
        resolve(42);
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-promise-executor-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty return in Promise executor', () => {
    const violations = check(`
      const p = new Promise((resolve) => {
        if (!valid) return;
        resolve(42);
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-promise-executor-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Language isolation
// ---------------------------------------------------------------------------

describe('bugs: language isolation', () => {
  it('does not fire bare-except on JS code', () => {
    const violations = check(`try { x() } catch(e) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bare-except');
    expect(matches).toHaveLength(0);
  });

  it('does not fire mutable-default-arg on JS code', () => {
    const violations = check(`function foo(x = []) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });

  it('does not fire assignment-in-condition on Python code', () => {
    // Python doesn't have assignment-in-condition in the same way
    const violations = check(`
if x == 5:
    print(x)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-in-condition');
    expect(matches).toHaveLength(0);
  });

  it('does not fire duplicate-args on JS code', () => {
    const violations = check(`function foo(a, b) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-args');
    expect(matches).toHaveLength(0);
  });

  it('does not fire no-self-compare on Python code', () => {
    const violations = check(`result = x != x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-self-compare');
    expect(matches).toHaveLength(0);
  });
});
