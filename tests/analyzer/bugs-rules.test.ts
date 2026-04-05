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

// ---------------------------------------------------------------------------
// JS/TS: unreachable-loop
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unreachable-loop', () => {
  it('detects for loop that always returns', () => {
    const violations = check(`
      function foo(arr) {
        for (let i = 0; i < arr.length; i++) {
          return arr[i];
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-loop');
    expect(matches).toHaveLength(1);
  });

  it('detects while loop that always breaks', () => {
    const violations = check(`
      while (x > 0) {
        break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-loop');
    expect(matches).toHaveLength(1);
  });

  it('does not flag loop with conditional exit', () => {
    const violations = check(`
      function foo(arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] > 5) return arr[i];
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreachable-loop');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: constant-binary-expression
// ---------------------------------------------------------------------------

describe('bugs/deterministic/constant-binary-expression', () => {
  it('detects "string" + undefined', () => {
    const violations = check(`const x = "hello" + undefined;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-binary-expression');
    expect(matches).toHaveLength(1);
  });

  it('detects null === undefined', () => {
    const violations = check(`const x = null === undefined;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-binary-expression');
    expect(matches).toHaveLength(1);
  });

  it('does not flag variable + literal', () => {
    const violations = check(`const x = y + 5;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-binary-expression');
    expect(matches).toHaveLength(0);
  });

  it('does not flag string + string concatenation', () => {
    const violations = check(`const x = "hello" + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constant-binary-expression');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: loop-counter-assignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/loop-counter-assignment', () => {
  it('detects assignment to loop counter in body', () => {
    const violations = check(`
      for (let i = 0; i < 10; i++) {
        i = 5;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-counter-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag increment of loop counter', () => {
    const violations = check(`
      for (let i = 0; i < 10; i++) {
        i += 2;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-counter-assignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unmodified-loop-condition
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unmodified-loop-condition', () => {
  it('detects while loop where condition var is unmodified', () => {
    const violations = check(`
      let x = 10;
      let y = 0;
      while (x > 0) {
        y = y + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unmodified-loop-condition');
    expect(matches).toHaveLength(1);
  });

  it('does not flag while loop where condition var is modified', () => {
    const violations = check(`
      let x = 10;
      while (x > 0) {
        x--;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unmodified-loop-condition');
    expect(matches).toHaveLength(0);
  });

  it('does not flag while loop with function calls (could modify condition)', () => {
    const violations = check(`
      let x = 10;
      while (x > 0) {
        doSomething();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unmodified-loop-condition');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: const-reassignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/const-reassignment', () => {
  it('detects reassignment of const variable', () => {
    const violations = check(`
      const x = 5;
      x = 10;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/const-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag reassignment of let variable', () => {
    const violations = check(`
      let x = 5;
      x = 10;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/const-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: class-reassignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/class-reassignment', () => {
  it('detects reassignment of class declaration', () => {
    const violations = check(`
      class Foo {}
      Foo = 42;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/class-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal variable assignment', () => {
    const violations = check(`
      class Foo {}
      const bar = 42;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/class-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: function-reassignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/function-reassignment', () => {
  it('detects reassignment of function declaration', () => {
    const violations = check(`
      function foo() {}
      foo = 42;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/function-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal usage of function', () => {
    const violations = check(`
      function foo() {}
      foo();
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/function-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: import-reassignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/import-reassignment', () => {
  it('detects reassignment of import binding', () => {
    const violations = check(`
      import { foo } from 'bar';
      foo = 42;
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/import-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal usage of import', () => {
    const violations = check(`
      import { foo } from 'bar';
      console.log(foo);
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/import-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: getter-missing-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/getter-missing-return', () => {
  it('detects getter without return', () => {
    const violations = check(`
      class Foo {
        get name() {
          this._name;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/getter-missing-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag getter with return', () => {
    const violations = check(`
      class Foo {
        get name() {
          return this._name;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/getter-missing-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: getter-missing-return
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/getter-missing-return', () => {
  it('detects @property getter without return', () => {
    const violations = check(`
class Foo:
    @property
    def name(self):
        self._name
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/getter-missing-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag @property getter with return', () => {
    const violations = check(`
class Foo:
    @property
    def name(self):
        return self._name
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/getter-missing-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: missing-super-call
// ---------------------------------------------------------------------------

describe('bugs/deterministic/missing-super-call', () => {
  it('detects constructor without super() in derived class', () => {
    const violations = check(`
      class Child extends Parent {
        constructor() {
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/missing-super-call');
    expect(matches).toHaveLength(1);
  });

  it('does not flag constructor with super()', () => {
    const violations = check(`
      class Child extends Parent {
        constructor() {
          super();
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/missing-super-call');
    expect(matches).toHaveLength(0);
  });

  it('does not flag class without extends', () => {
    const violations = check(`
      class Base {
        constructor() {
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/missing-super-call');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: this-before-super
// ---------------------------------------------------------------------------

describe('bugs/deterministic/this-before-super', () => {
  it('detects this before super() in derived constructor', () => {
    const violations = check(`
      class Child extends Parent {
        constructor() {
          this.x = 1;
          super();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/this-before-super');
    expect(matches).toHaveLength(1);
  });

  it('does not flag this after super()', () => {
    const violations = check(`
      class Child extends Parent {
        constructor() {
          super();
          this.x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/this-before-super');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: async-promise-executor
// ---------------------------------------------------------------------------

describe('bugs/deterministic/async-promise-executor', () => {
  it('detects async arrow function executor', () => {
    const violations = check(`
      const p = new Promise(async (resolve) => {
        resolve(await fetch());
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/async-promise-executor');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-async executor', () => {
    const violations = check(`
      const p = new Promise((resolve) => {
        resolve(42);
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/async-promise-executor');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: empty-character-class
// ---------------------------------------------------------------------------

describe('bugs/deterministic/empty-character-class', () => {
  it('detects regex with empty character class', () => {
    const violations = check(`const re = /abc[]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-character-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regex with non-empty character class', () => {
    const violations = check(`const re = /abc[a-z]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-character-class');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: empty-character-class
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/empty-character-class', () => {
  it('detects re.compile with empty character class', () => {
    const violations = check(`
import re
pattern = re.compile("abc[]")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-character-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag re.compile with non-empty character class', () => {
    const violations = check(`
import re
pattern = re.compile("abc[a-z]")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-character-class');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: invalid-regexp
// ---------------------------------------------------------------------------

describe('bugs/deterministic/invalid-regexp', () => {
  it('detects RegExp with invalid pattern', () => {
    const violations = check(`const re = new RegExp("[");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-regexp');
    expect(matches).toHaveLength(1);
  });

  it('does not flag RegExp with valid pattern', () => {
    const violations = check(`const re = new RegExp("[a-z]+");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-regexp');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: sparse-array
// ---------------------------------------------------------------------------

describe('bugs/deterministic/sparse-array', () => {
  it('detects array with empty slots', () => {
    const violations = check(`const arr = [1,,3];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/sparse-array');
    expect(matches).toHaveLength(1);
  });

  it('does not flag dense array', () => {
    const violations = check(`const arr = [1, 2, 3];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/sparse-array');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: prototype-pollution
// ---------------------------------------------------------------------------

describe('bugs/deterministic/prototype-pollution', () => {
  it('detects obj[key] = value with dynamic key', () => {
    const violations = check(`obj[key] = value;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-pollution');
    expect(matches).toHaveLength(1);
  });

  it('does not flag obj["literal"] = value', () => {
    const violations = check(`obj["name"] = value;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-pollution');
    expect(matches).toHaveLength(0);
  });

  it('does not flag obj.prop = value', () => {
    const violations = check(`obj.prop = value;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-pollution');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: void-zero-argument
// ---------------------------------------------------------------------------

describe('bugs/deterministic/void-zero-argument', () => {
  it('detects void 0', () => {
    const violations = check(`const x = void 0;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/void-zero-argument');
    expect(matches).toHaveLength(1);
  });

  it('detects void expression', () => {
    const violations = check(`void doSomething();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/void-zero-argument');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: exception-reassignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/exception-reassignment', () => {
  it('detects reassignment of catch parameter', () => {
    const violations = check(`
      try { throw new Error(); } catch (e) {
        e = new Error("replaced");
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag reading catch parameter', () => {
    const violations = check(`
      try { throw new Error(); } catch (e) {
        console.log(e);
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: exception-reassignment
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/exception-reassignment', () => {
  it('detects reassignment of except parameter', () => {
    const violations = check(`
try:
    raise ValueError()
except ValueError as e:
    e = Exception("replaced")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag reading except parameter', () => {
    const violations = check(`
try:
    raise ValueError()
except ValueError as e:
    print(e)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-reassignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: null-dereference
// ---------------------------------------------------------------------------

describe('bugs/deterministic/null-dereference', () => {
  it('detects null.property access', () => {
    const violations = check(`const x = null.foo;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/null-dereference');
    expect(matches).toHaveLength(1);
  });

  it('detects undefined.property access', () => {
    const violations = check(`const x = undefined.bar;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/null-dereference');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal property access', () => {
    const violations = check(`const x = obj.foo;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/null-dereference');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: symbol-description
// ---------------------------------------------------------------------------

describe('bugs/deterministic/symbol-description', () => {
  it('detects Symbol() without description', () => {
    const violations = check(`const s = Symbol();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/symbol-description');
    expect(matches).toHaveLength(1);
  });

  it('detects Symbol(undefined)', () => {
    const violations = check(`const s = Symbol(undefined);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/symbol-description');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Symbol with description', () => {
    const violations = check(`const s = Symbol("mySymbol");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/symbol-description');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: array-callback-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/array-callback-return', () => {
  it('detects map callback without return', () => {
    const violations = check(`
      const result = arr.map((x) => {
        x * 2;
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-callback-return');
    expect(matches).toHaveLength(1);
  });

  it('detects filter callback without return', () => {
    const violations = check(`
      const result = arr.filter(function(x) {
        x > 5;
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-callback-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag map with expression body (implicit return)', () => {
    const violations = check(`const result = arr.map((x) => x * 2);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-callback-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag map callback with return', () => {
    const violations = check(`
      const result = arr.map((x) => {
        return x * 2;
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-callback-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag forEach (no return needed)', () => {
    const violations = check(`
      arr.forEach((x) => {
        console.log(x);
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-callback-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: no-inner-declarations
// ---------------------------------------------------------------------------

describe('bugs/deterministic/no-inner-declarations', () => {
  it('detects function declaration inside if block', () => {
    const violations = check(`
      if (condition) {
        function foo() { return 1; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-inner-declarations');
    expect(matches).toHaveLength(1);
  });

  it('detects var declaration inside if block', () => {
    const violations = check(`
      if (condition) {
        var x = 5;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-inner-declarations');
    expect(matches).toHaveLength(1);
  });

  it('does not flag let inside if block', () => {
    const violations = check(`
      if (condition) {
        let x = 5;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-inner-declarations');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function declaration at top level', () => {
    const violations = check(`function foo() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/no-inner-declarations');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: template-curly-in-string
// ---------------------------------------------------------------------------

describe('bugs/deterministic/template-curly-in-string', () => {
  it('detects ${name} in double-quoted string', () => {
    const violations = check(`const msg = "Hello \${name}!";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/template-curly-in-string');
    expect(matches).toHaveLength(1);
  });

  it('does not flag template literal', () => {
    const violations = check('const msg = `Hello ${name}!`;');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/template-curly-in-string');
    expect(matches).toHaveLength(0);
  });

  it('does not flag plain string without template expression', () => {
    const violations = check(`const msg = "Hello world";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/template-curly-in-string');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: await-in-loop
// ---------------------------------------------------------------------------

describe('bugs/deterministic/await-in-loop', () => {
  it('detects await inside for loop', () => {
    const violations = check(`
      async function fetchAll(ids) {
        for (const id of ids) {
          const result = await fetch(id);
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/await-in-loop');
    expect(matches).toHaveLength(1);
  });

  it('detects await inside while loop', () => {
    const violations = check(`
      async function process() {
        while (queue.length > 0) {
          await processItem(queue.pop());
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/await-in-loop');
    expect(matches).toHaveLength(1);
  });

  it('does not flag await outside a loop', () => {
    const violations = check(`
      async function fetchOne(id) {
        const result = await fetch(id);
        return result;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/await-in-loop');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: element-overwrite
// ---------------------------------------------------------------------------

describe('bugs/deterministic/element-overwrite', () => {
  it('detects array element overwritten before read', () => {
    const violations = check(`
      {
        arr[0] = 1;
        arr[0] = 2;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/element-overwrite');
    expect(matches).toHaveLength(1);
  });

  it('does not flag when element is read between assignments', () => {
    const violations = check(`
      {
        arr[0] = 1;
        console.log(arr[0]);
        arr[0] = 2;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/element-overwrite');
    expect(matches).toHaveLength(0);
  });

  it('does not flag different indices', () => {
    const violations = check(`
      {
        arr[0] = 1;
        arr[1] = 2;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/element-overwrite');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unthrown-error
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unthrown-error', () => {
  it('detects new Error() without throw', () => {
    const violations = check(`
      function validate(x) {
        if (!x) new Error("invalid");
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unthrown-error');
    expect(matches).toHaveLength(1);
  });

  it('detects new TypeError() without throw', () => {
    const violations = check(`new TypeError("bad type");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unthrown-error');
    expect(matches).toHaveLength(1);
  });

  it('does not flag throw new Error()', () => {
    const violations = check(`throw new Error("error");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unthrown-error');
    expect(matches).toHaveLength(0);
  });

  it('does not flag assigned new Error()', () => {
    const violations = check(`const err = new Error("error");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unthrown-error');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: non-existent-operator
// ---------------------------------------------------------------------------

describe('bugs/deterministic/non-existent-operator', () => {
  it('detects x =+ y (should be +=)', () => {
    const violations = check(`x =+ 5;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/non-existent-operator');
    expect(matches).toHaveLength(1);
  });

  it('detects x =! y (should be !=)', () => {
    const violations = check(`x =! y;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/non-existent-operator');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x += 5', () => {
    const violations = check(`x += 5;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/non-existent-operator');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: in-operator-on-primitive
// ---------------------------------------------------------------------------

describe('bugs/deterministic/in-operator-on-primitive', () => {
  it('detects "prop" in null', () => {
    const violations = check(`if ("prop" in null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/in-operator-on-primitive');
    expect(matches).toHaveLength(1);
  });

  it('detects "key" in undefined', () => {
    const violations = check(`const x = "key" in undefined;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/in-operator-on-primitive');
    expect(matches).toHaveLength(1);
  });

  it('does not flag "prop" in obj', () => {
    const violations = check(`if ("prop" in obj) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/in-operator-on-primitive');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: useless-increment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/useless-increment', () => {
  it('detects ++x as standalone statement', () => {
    const violations = check(`
      function foo() {
        ++counter;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-increment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x++ as standalone (post-increment)', () => {
    const violations = check(`
      function foo() {
        counter++;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-increment');
    expect(matches).toHaveLength(0);
  });

  it('does not flag ++x in a for loop increment', () => {
    const violations = check(`for (let i = 0; i < 10; ++i) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-increment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: ignored-return-value
// ---------------------------------------------------------------------------

describe('bugs/deterministic/ignored-return-value', () => {
  it('detects ignored arr.map() result', () => {
    const violations = check(`arr.map(x => x * 2);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/ignored-return-value');
    expect(matches).toHaveLength(1);
  });

  it('detects ignored arr.filter() result', () => {
    const violations = check(`arr.filter(x => x > 0);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/ignored-return-value');
    expect(matches).toHaveLength(1);
  });

  it('does not flag when result is assigned', () => {
    const violations = check(`const result = arr.map(x => x * 2);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/ignored-return-value');
    expect(matches).toHaveLength(0);
  });

  it('does not flag arr.forEach()', () => {
    const violations = check(`arr.forEach(x => console.log(x));`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/ignored-return-value');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: collection-size-mischeck
// ---------------------------------------------------------------------------

describe('bugs/deterministic/collection-size-mischeck', () => {
  it('detects arr.length === undefined', () => {
    const violations = check(`if (arr.length === undefined) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/collection-size-mischeck');
    expect(matches).toHaveLength(1);
  });

  it('detects arr.length === null', () => {
    const violations = check(`if (arr.length === null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/collection-size-mischeck');
    expect(matches).toHaveLength(1);
  });

  it('does not flag arr.length > 0', () => {
    const violations = check(`if (arr.length > 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/collection-size-mischeck');
    expect(matches).toHaveLength(0);
  });

  it('does not flag arr.length === 0', () => {
    const violations = check(`if (arr.length === 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/collection-size-mischeck');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: arguments-order-mismatch
// ---------------------------------------------------------------------------

describe('bugs/deterministic/arguments-order-mismatch', () => {
  it('detects swapped args: str.startsWith(str)', () => {
    const violations = check(`
      const result = str.startsWith(str);
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/arguments-order-mismatch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag str.startsWith(prefix)', () => {
    const violations = check(`const result = str.startsWith("foo");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/arguments-order-mismatch');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: unexpected-multiline
// ---------------------------------------------------------------------------

describe('bugs/deterministic/unexpected-multiline', () => {
  it('detects bare return followed by expression on next line', () => {
    const violations = check(`
      function foo() {
        return
        x + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-multiline');
    expect(matches).toHaveLength(1);
  });

  it('does not flag return with value on same line', () => {
    const violations = check(`
      function foo() {
        return x + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-multiline');
    expect(matches).toHaveLength(0);
  });

  it('does not flag bare return at end of function', () => {
    const violations = check(`
      function foo() {
        if (!valid) return;
        doWork();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-multiline');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: empty-collection-access
// ---------------------------------------------------------------------------

describe('bugs/deterministic/empty-collection-access', () => {
  it('detects accessing index on empty array literal', () => {
    const violations = check(`const x = [][0];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-collection-access');
    expect(matches).toHaveLength(1);
  });

  it('does not flag access on non-empty array', () => {
    const violations = check(`const x = [1, 2, 3][0];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-collection-access');
    expect(matches).toHaveLength(0);
  });

  it('does not flag access on variable', () => {
    const violations = check(`const x = arr[0];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/empty-collection-access');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: void-return-value-used
// ---------------------------------------------------------------------------

describe('bugs/deterministic/void-return-value-used', () => {
  it('detects assigning forEach result', () => {
    const violations = check(`const result = arr.forEach(x => console.log(x));`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/void-return-value-used');
    expect(matches).toHaveLength(1);
  });

  it('detects assigning console.log result', () => {
    const violations = check(`const x = console.log("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/void-return-value-used');
    expect(matches).toHaveLength(1);
  });

  it('does not flag arr.map() result', () => {
    const violations = check(`const result = arr.map(x => x * 2);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/void-return-value-used');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: new-operator-misuse
// ---------------------------------------------------------------------------

describe('bugs/deterministic/new-operator-misuse', () => {
  it('detects new Symbol()', () => {
    const violations = check(`const s = new Symbol("id");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/new-operator-misuse');
    expect(matches).toHaveLength(1);
  });

  it('detects new BigInt()', () => {
    const violations = check(`const n = new BigInt(42);`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/new-operator-misuse');
    expect(matches).toHaveLength(1);
  });

  it('does not flag new Error()', () => {
    const violations = check(`throw new Error("oops");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/new-operator-misuse');
    expect(matches).toHaveLength(0);
  });

  it('does not flag new Map()', () => {
    const violations = check(`const m = new Map();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/new-operator-misuse');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: useless-backreference
// ---------------------------------------------------------------------------

describe('bugs/deterministic/useless-backreference', () => {
  it('detects forward backreference \\1 before group definition', () => {
    const violations = check(`const re = /\\1(abc)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-backreference');
    expect(matches).toHaveLength(1);
  });

  it('does not flag \\1 after its group is defined', () => {
    const violations = check(`const re = /(abc)\\1/;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-backreference');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex without backreferences', () => {
    const violations = check(`const re = /[a-z]+/;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-backreference');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: dissimilar-type-comparison
// ---------------------------------------------------------------------------

describe('bugs/deterministic/dissimilar-type-comparison', () => {
  it('detects string === number', () => {
    const violations = check(`if ("foo" === 42) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/dissimilar-type-comparison');
    expect(matches).toHaveLength(1);
  });

  it('detects number === boolean', () => {
    const violations = check(`if (1 === true) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/dissimilar-type-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag same-type comparison', () => {
    const violations = check(`if (x === "foo") {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/dissimilar-type-comparison');
    expect(matches).toHaveLength(0);
  });

  it('does not flag null === undefined (common idiom)', () => {
    const violations = check(`if (x === null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/dissimilar-type-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: index-of-positive-check
// ---------------------------------------------------------------------------

describe('bugs/deterministic/index-of-positive-check', () => {
  it('detects indexOf compared to positive number', () => {
    const violations = check(`if (arr.indexOf(x) > 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/index-of-positive-check');
    expect(matches).toHaveLength(1);
  });

  it('detects indexOf >= 1', () => {
    const violations = check(`const found = arr.indexOf(x) >= 1;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/index-of-positive-check');
    expect(matches).toHaveLength(1);
  });

  it('does not flag indexOf !== -1', () => {
    const violations = check(`if (arr.indexOf(x) !== -1) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/index-of-positive-check');
    expect(matches).toHaveLength(0);
  });

  it('does not flag indexOf === -1', () => {
    const violations = check(`if (arr.indexOf(x) === -1) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/index-of-positive-check');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: array-delete
// ---------------------------------------------------------------------------

describe('bugs/deterministic/array-delete', () => {
  it('detects delete on array element', () => {
    const violations = check(`delete arr[0];`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-delete');
    expect(matches).toHaveLength(1);
  });

  it('does not flag delete on object property', () => {
    const violations = check(`delete obj.prop;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/array-delete');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: comma-in-switch-case
// ---------------------------------------------------------------------------

describe('bugs/deterministic/comma-in-switch-case', () => {
  it('detects comma expression in switch case value', () => {
    const violations = check(`
      switch (x) {
        case (a, b):
          doSomething();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/comma-in-switch-case');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal switch case', () => {
    const violations = check(`
      switch (x) {
        case 1:
          doSomething();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/comma-in-switch-case');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: literal-call
// ---------------------------------------------------------------------------

describe('bugs/deterministic/literal-call', () => {
  it('detects calling a number literal', () => {
    const violations = check(`5();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/literal-call');
    expect(matches).toHaveLength(1);
  });

  it('does not flag calling a function', () => {
    const violations = check(`foo();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/literal-call');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: prototype-builtins-call
// ---------------------------------------------------------------------------

describe('bugs/deterministic/prototype-builtins-call', () => {
  it('detects obj.hasOwnProperty(key)', () => {
    const violations = check(`if (obj.hasOwnProperty("key")) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-builtins-call');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Object.prototype.hasOwnProperty.call(obj, key)', () => {
    const violations = check(`if (Object.prototype.hasOwnProperty.call(obj, "key")) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-builtins-call');
    expect(matches).toHaveLength(0);
  });

  it('does not flag Object.hasOwn()', () => {
    const violations = check(`if (Object.hasOwn(obj, "key")) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/prototype-builtins-call');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: stateful-regex
// ---------------------------------------------------------------------------

describe('bugs/deterministic/stateful-regex', () => {
  it('detects global regex used inline in test call', () => {
    const violations = check(`if (/abc/g.test(str)) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/stateful-regex');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regex stored in variable', () => {
    const violations = check(`const re = /abc/g;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/stateful-regex');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex without global/sticky flag', () => {
    const violations = check(`if (/abc/i.test(str)) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/stateful-regex');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: incorrect-string-concat
// ---------------------------------------------------------------------------

describe('bugs/deterministic/incorrect-string-concat', () => {
  it('detects "string" + number', () => {
    const violations = check(`const x = "value: " + 42;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/incorrect-string-concat');
    expect(matches).toHaveLength(1);
  });

  it('detects number + "string"', () => {
    const violations = check(`const x = 10 + " items";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/incorrect-string-concat');
    expect(matches).toHaveLength(1);
  });

  it('does not flag variable + string', () => {
    const violations = check(`const x = name + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/incorrect-string-concat');
    expect(matches).toHaveLength(0);
  });

  it('does not flag string + string', () => {
    const violations = check(`const x = "hello" + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/incorrect-string-concat');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: misleading-array-reverse
// ---------------------------------------------------------------------------

describe('bugs/deterministic/misleading-array-reverse', () => {
  it('detects const sorted = arr.reverse()', () => {
    const violations = check(`const reversed = arr.reverse();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-array-reverse');
    expect(matches).toHaveLength(1);
  });

  it('detects let sorted = arr.sort()', () => {
    const violations = check(`let sorted = arr.sort();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-array-reverse');
    expect(matches).toHaveLength(1);
  });

  it('does not flag arr.reverse() as standalone statement', () => {
    const violations = check(`arr.reverse();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-array-reverse');
    expect(matches).toHaveLength(0);
  });

  it('does not flag [...arr].reverse()', () => {
    const violations = check(`const reversed = [...arr].reverse();`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-array-reverse');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: global-this-usage
// ---------------------------------------------------------------------------

describe('bugs/deterministic/global-this-usage', () => {
  it('detects this at top level', () => {
    const violations = check(`const x = this.foo;`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/global-this-usage');
    expect(matches).toHaveLength(1);
  });

  it('does not flag this inside a class method', () => {
    const violations = check(`
      class Foo {
        bar() {
          return this.x;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/global-this-usage');
    expect(matches).toHaveLength(0);
  });

  it('does not flag this inside a regular function', () => {
    const violations = check(`
      function foo() {
        return this.x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/global-this-usage');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS: inconsistent-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/inconsistent-return', () => {
  it('detects function with mixed return/no-return', () => {
    const violations = check(`
      function foo(x) {
        if (x > 0) return x;
        // no return here
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/inconsistent-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function that always returns', () => {
    const violations = check(`
      function foo(x) {
        if (x > 0) return x;
        return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/inconsistent-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function that never returns a value', () => {
    const violations = check(`
      function foo(x) {
        if (!x) return;
        doSomething(x);
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/inconsistent-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: assert-on-tuple
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/assert-on-tuple', () => {
  it('detects assert (condition, message)', () => {
    const violations = check(`
assert (x > 0, "x must be positive")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-on-tuple');
    expect(matches).toHaveLength(1);
  });

  it('does not flag assert condition, message', () => {
    const violations = check(`
assert x > 0, "x must be positive"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-on-tuple');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: fstring-missing-placeholders
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/fstring-missing-placeholders', () => {
  it('detects f-string without placeholders', () => {
    const violations = check(`msg = f"Hello world"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fstring-missing-placeholders');
    expect(matches).toHaveLength(1);
  });

  it('does not flag f-string with placeholders', () => {
    const violations = check(`msg = f"Hello {name}"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fstring-missing-placeholders');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regular string without f-prefix', () => {
    const violations = check(`msg = "Hello world"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fstring-missing-placeholders');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: raise-not-implemented
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/raise-not-implemented', () => {
  it('detects raise NotImplemented', () => {
    const violations = check(`raise NotImplemented`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-not-implemented');
    expect(matches).toHaveLength(1);
  });

  it('does not flag raise NotImplementedError', () => {
    const violations = check(`raise NotImplementedError("not implemented")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-not-implemented');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: is-literal-comparison
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/is-literal-comparison', () => {
  it('detects x is "string"', () => {
    const violations = check(`if x is "hello": pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/is-literal-comparison');
    expect(matches).toHaveLength(1);
  });

  it('detects x is 42', () => {
    const violations = check(`if x is 42: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/is-literal-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x is None', () => {
    const violations = check(`if x is None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/is-literal-comparison');
    expect(matches).toHaveLength(0);
  });

  it('does not flag x == "string"', () => {
    const violations = check(`if x == "hello": pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/is-literal-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: none-comparison-with-equality
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/none-comparison-with-equality', () => {
  it('detects x == None', () => {
    const violations = check(`if x == None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/none-comparison-with-equality');
    expect(matches).toHaveLength(1);
  });

  it('detects x != None', () => {
    const violations = check(`if x != None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/none-comparison-with-equality');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x is None', () => {
    const violations = check(`if x is None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/none-comparison-with-equality');
    expect(matches).toHaveLength(0);
  });

  it('does not flag x is not None', () => {
    const violations = check(`if x is not None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/none-comparison-with-equality');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: type-comparison-instead-of-isinstance
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/type-comparison-instead-of-isinstance', () => {
  it('detects type(x) == int', () => {
    const violations = check(`if type(x) == int: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/type-comparison-instead-of-isinstance');
    expect(matches).toHaveLength(1);
  });

  it('does not flag isinstance(x, int)', () => {
    const violations = check(`if isinstance(x, int): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/type-comparison-instead-of-isinstance');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-set-value
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-set-value', () => {
  it('detects duplicate values in set literal', () => {
    const violations = check(`s = {1, 2, 1}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-set-value');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique set values', () => {
    const violations = check(`s = {1, 2, 3}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-set-value');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: loop-variable-overrides-iterator
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/loop-variable-overrides-iterator', () => {
  it('detects for x in x', () => {
    const violations = check(`for x in x: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-variable-overrides-iterator');
    expect(matches).toHaveLength(1);
  });

  it('does not flag for item in items', () => {
    const violations = check(`for item in items: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-variable-overrides-iterator');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: raise-without-from-in-except
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/raise-without-from-in-except', () => {
  it('detects raise without from in except', () => {
    const violations = check(`
try:
    do_something()
except ValueError:
    raise RuntimeError("failed")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-without-from-in-except');
    expect(matches).toHaveLength(1);
  });

  it('does not flag raise ... from e', () => {
    const violations = check(`
try:
    do_something()
except ValueError as e:
    raise RuntimeError("failed") from e
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-without-from-in-except');
    expect(matches).toHaveLength(0);
  });

  it('does not flag bare re-raise', () => {
    const violations = check(`
try:
    do_something()
except ValueError:
    raise
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-without-from-in-except');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: init-return-value
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/init-return-value', () => {
  it('detects __init__ returning a value', () => {
    const violations = check(`
class Foo:
    def __init__(self):
        return self
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/init-return-value');
    expect(matches).toHaveLength(1);
  });

  it('does not flag __init__ with bare return', () => {
    const violations = check(`
class Foo:
    def __init__(self):
        if not self.valid:
            return
        self.setup()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/init-return-value');
    expect(matches).toHaveLength(0);
  });

  it('does not flag other methods', () => {
    const violations = check(`
class Foo:
    def build(self):
        return self
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/init-return-value');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: yield-in-init
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/yield-in-init', () => {
  it('detects yield in __init__', () => {
    const violations = check(`
class Foo:
    def __init__(self):
        yield 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/yield-in-init');
    expect(matches).toHaveLength(1);
  });

  it('does not flag yield in other method', () => {
    const violations = check(`
class Foo:
    def generate(self):
        yield 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/yield-in-init');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-base-classes
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-base-classes', () => {
  it('detects duplicate base class', () => {
    const violations = check(`class Foo(A, B, A): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-base-classes');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique base classes', () => {
    const violations = check(`class Foo(A, B, C): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-base-classes');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: float-equality-comparison
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/float-equality-comparison', () => {
  it('detects x == 0.5', () => {
    const violations = check(`if x == 0.5: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/float-equality-comparison');
    expect(matches).toHaveLength(1);
  });

  it('detects x != 1.0', () => {
    const violations = check(`if x != 1.0: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/float-equality-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x == 1 (integer)', () => {
    const violations = check(`if x == 1: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/float-equality-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: function-call-in-default-argument
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/function-call-in-default-argument', () => {
  it('detects function call in default arg', () => {
    const violations = check(`
import datetime
def foo(ts=datetime.now()):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/function-call-in-default-argument');
    expect(matches).toHaveLength(1);
  });

  it('does not flag None default', () => {
    const violations = check(`def foo(ts=None): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/function-call-in-default-argument');
    expect(matches).toHaveLength(0);
  });

  it('does not flag literal defaults', () => {
    const violations = check(`def foo(x=5, name="default"): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/function-call-in-default-argument');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: zip-without-strict
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/zip-without-strict', () => {
  it('detects zip() without strict', () => {
    const violations = check(`result = list(zip(a, b))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/zip-without-strict');
    expect(matches).toHaveLength(1);
  });

  it('does not flag zip() with strict=True', () => {
    const violations = check(`result = list(zip(a, b, strict=True))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/zip-without-strict');
    expect(matches).toHaveLength(0);
  });

  it('does not flag zip() with single iterable', () => {
    const violations = check(`result = list(zip(a))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/zip-without-strict');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: raise-literal
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/raise-literal', () => {
  it('detects raise with string literal', () => {
    const violations = check(`raise "something went wrong"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-literal');
    expect(matches).toHaveLength(1);
  });

  it('detects raise with integer literal', () => {
    const violations = check(`raise 42`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-literal');
    expect(matches).toHaveLength(1);
  });

  it('does not flag raise with exception class', () => {
    const violations = check(`raise ValueError("bad value")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-literal');
    expect(matches).toHaveLength(0);
  });

  it('does not flag bare raise', () => {
    const violations = check(`
try:
    pass
except Exception:
    raise
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/raise-literal');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: bad-open-mode
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/bad-open-mode', () => {
  it('detects invalid mode rw', () => {
    const violations = check(`f = open("file.txt", "rw")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bad-open-mode');
    expect(matches).toHaveLength(1);
  });

  it('does not flag valid mode r', () => {
    const violations = check(`f = open("file.txt", "r")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bad-open-mode');
    expect(matches).toHaveLength(0);
  });

  it('does not flag valid mode rb', () => {
    const violations = check(`f = open("file.txt", "rb")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bad-open-mode');
    expect(matches).toHaveLength(0);
  });

  it('does not flag valid mode w+', () => {
    const violations = check(`f = open("file.txt", "w+")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bad-open-mode');
    expect(matches).toHaveLength(0);
  });

  it('detects mode with invalid combo', () => {
    const violations = check(`f = open("file.txt", "abc")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/bad-open-mode');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Python: loop-at-most-one-iteration
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/loop-at-most-one-iteration', () => {
  it('detects for loop with unconditional break', () => {
    const violations = check(`
for x in items:
    process(x)
    break
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-at-most-one-iteration');
    expect(matches).toHaveLength(1);
  });

  it('detects for loop with unconditional return', () => {
    const violations = check(`
def foo():
    for x in items:
        process(x)
        return x
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-at-most-one-iteration');
    expect(matches).toHaveLength(1);
  });

  it('does not flag loop with conditional break', () => {
    const violations = check(`
for x in items:
    if condition:
        break
    process(x)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-at-most-one-iteration');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal loop', () => {
    const violations = check(`
for x in items:
    process(x)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/loop-at-most-one-iteration');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: break-continue-in-finally
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/break-continue-in-finally', () => {
  it('detects break in finally block', () => {
    const violations = check(`
for x in items:
    try:
        process(x)
    finally:
        break
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/break-continue-in-finally');
    expect(matches).toHaveLength(1);
  });

  it('detects continue in finally block', () => {
    const violations = check(`
for x in items:
    try:
        process(x)
    finally:
        continue
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/break-continue-in-finally');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal finally block', () => {
    const violations = check(`
try:
    process()
finally:
    cleanup()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/break-continue-in-finally');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: infinite-recursion
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/infinite-recursion', () => {
  it('detects unconditional recursive call as first statement', () => {
    const violations = check(`
def foo():
    foo()
    return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/infinite-recursion');
    expect(matches).toHaveLength(1);
  });

  it('detects function that only returns a recursive call', () => {
    const violations = check(`
def bar():
    return bar()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/infinite-recursion');
    expect(matches).toHaveLength(1);
  });

  it('does not flag conditional recursive call', () => {
    const violations = check(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/infinite-recursion');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-handler-exception
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-handler-exception', () => {
  it('detects duplicate exception in same clause', () => {
    const violations = check(`
try:
    pass
except (ValueError, ValueError):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-handler-exception');
    expect(matches).toHaveLength(1);
  });

  it('detects same exception in multiple except clauses', () => {
    const violations = check(`
try:
    pass
except ValueError:
    handle1()
except ValueError:
    handle2()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-handler-exception');
    expect(matches).toHaveLength(1);
  });

  it('does not flag distinct exceptions', () => {
    const violations = check(`
try:
    pass
except ValueError:
    handle1()
except TypeError:
    handle2()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-handler-exception');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: mutable-class-default
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/mutable-class-default', () => {
  it('detects list class variable', () => {
    const violations = check(`
class Foo:
    items = []
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-class-default');
    expect(matches).toHaveLength(1);
  });

  it('detects dict class variable', () => {
    const violations = check(`
class Foo:
    data = {}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-class-default');
    expect(matches).toHaveLength(1);
  });

  it('does not flag immutable class variable', () => {
    const violations = check(`
class Foo:
    count = 0
    name = "default"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-class-default');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: mutable-dataclass-default
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/mutable-dataclass-default', () => {
  it('detects mutable default in dataclass', () => {
    const violations = check(`
from dataclasses import dataclass

@dataclass
class Foo:
    items = []
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-dataclass-default');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular class with mutable default (caught by different rule)', () => {
    const violations = check(`
class Foo:
    items = []
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-dataclass-default');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: await-outside-async
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/await-outside-async', () => {
  it('detects await in non-async function', () => {
    const violations = check(`
def foo():
    result = await some_coroutine()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/await-outside-async');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag await in async function', () => {
    const violations = check(`
async def foo():
    result = await some_coroutine()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/await-outside-async');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: asyncio-dangling-task
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/asyncio-dangling-task', () => {
  it('detects asyncio.create_task not saved', () => {
    const violations = check(`
import asyncio
asyncio.create_task(coro())
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/asyncio-dangling-task');
    expect(matches).toHaveLength(1);
  });

  it('does not flag create_task when result is saved', () => {
    const violations = check(`
import asyncio
task = asyncio.create_task(coro())
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/asyncio-dangling-task');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: unexpected-special-method-signature
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/unexpected-special-method-signature', () => {
  it('detects __len__ with wrong params', () => {
    const violations = check(`
class Foo:
    def __len__(self, extra):
        return 0
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-special-method-signature');
    expect(matches).toHaveLength(1);
  });

  it('does not flag __len__ with correct params', () => {
    const violations = check(`
class Foo:
    def __len__(self):
        return 0
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-special-method-signature');
    expect(matches).toHaveLength(0);
  });

  it('detects __exit__ with wrong params', () => {
    const violations = check(`
class Foo:
    def __exit__(self, exc_type):
        pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unexpected-special-method-signature');
    expect(matches).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-function-arguments
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-function-arguments', () => {
  it('detects duplicate keyword argument in call', () => {
    const violations = check(`foo(x=1, y=2, x=3)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-function-arguments');
    expect(matches).toHaveLength(1);
  });

  it('does not flag distinct keyword arguments', () => {
    const violations = check(`foo(x=1, y=2, z=3)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-function-arguments');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: not-implemented-in-bool-context
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/not-implemented-in-bool-context', () => {
  it('detects NotImplemented in if condition', () => {
    const violations = check(`
if NotImplemented:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/not-implemented-in-bool-context');
    expect(matches).toHaveLength(1);
  });

  it('detects NotImplemented in assert', () => {
    const violations = check(`assert NotImplemented`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/not-implemented-in-bool-context');
    expect(matches).toHaveLength(1);
  });

  it('does not flag NotImplementedError in if', () => {
    const violations = check(`
if NotImplementedError:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/not-implemented-in-bool-context');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: cancellation-exception-not-reraised
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/cancellation-exception-not-reraised', () => {
  it('detects CancelledError caught without re-raise', () => {
    const violations = check(`
import asyncio
try:
    await asyncio.sleep(10)
except asyncio.CancelledError:
    cleanup()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/cancellation-exception-not-reraised');
    expect(matches).toHaveLength(1);
  });

  it('does not flag CancelledError with re-raise', () => {
    const violations = check(`
import asyncio
try:
    await asyncio.sleep(10)
except asyncio.CancelledError:
    cleanup()
    raise
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/cancellation-exception-not-reraised');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: assert-raises-too-broad
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/assert-raises-too-broad', () => {
  it('detects pytest.raises(Exception)', () => {
    const violations = check(`
import pytest
with pytest.raises(Exception):
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-raises-too-broad');
    expect(matches).toHaveLength(1);
  });

  it('does not flag pytest.raises with specific exception', () => {
    const violations = check(`
import pytest
with pytest.raises(ValueError):
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-raises-too-broad');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: hashable-set-dict-member
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/hashable-set-dict-member', () => {
  it('detects list as dict key', () => {
    const violations = check(`d = {[1, 2]: "value"}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/hashable-set-dict-member');
    expect(matches).toHaveLength(1);
  });

  it('detects list as set member', () => {
    const violations = check(`s = {[1, 2], 3}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/hashable-set-dict-member');
    expect(matches).toHaveLength(1);
  });

  it('does not flag tuple as dict key', () => {
    const violations = check(`d = {(1, 2): "value"}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/hashable-set-dict-member');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal dict', () => {
    const violations = check(`d = {"key": "value", 1: "num"}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/hashable-set-dict-member');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: iter-not-returning-iterator
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/iter-not-returning-iterator', () => {
  it('detects __iter__ returning non-self value', () => {
    const violations = check(`
class Foo:
    def __iter__(self):
        return []
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/iter-not-returning-iterator');
    expect(matches).toHaveLength(1);
  });

  it('does not flag __iter__ returning self', () => {
    const violations = check(`
class Foo:
    def __iter__(self):
        return self
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/iter-not-returning-iterator');
    expect(matches).toHaveLength(0);
  });

  it('does not flag __iter__ using yield (generator)', () => {
    const violations = check(`
class Foo:
    def __iter__(self):
        yield 1
        yield 2
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/iter-not-returning-iterator');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: modified-loop-iterator
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/modified-loop-iterator', () => {
  it('detects set mutation during iteration', () => {
    const violations = check(`
for x in my_set:
    my_set.add(x + 1)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/modified-loop-iterator');
    expect(matches).toHaveLength(1);
  });

  it('detects dict mutation during iteration', () => {
    const violations = check(`
for key in my_dict:
    my_dict.pop(key)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/modified-loop-iterator');
    expect(matches).toHaveLength(1);
  });

  it('does not flag iterating over a copy', () => {
    const violations = check(`
for x in list(my_set):
    my_set.add(x + 1)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/modified-loop-iterator');
    expect(matches).toHaveLength(0);
  });

  it('does not flag mutation of a different collection', () => {
    const violations = check(`
for x in items:
    other_set.add(x)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/modified-loop-iterator');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: undefined-export
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/undefined-export', () => {
  it('detects name in __all__ that is not defined', () => {
    const violations = check(`
__all__ = ["foo", "bar"]

def foo():
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/undefined-export');
    expect(matches).toHaveLength(1);
  });

  it('does not flag __all__ when all names are defined', () => {
    const violations = check(`
__all__ = ["foo", "bar"]

def foo():
    pass

def bar():
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/undefined-export');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: string-format-mismatch
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/string-format-mismatch', () => {
  it('detects too few arguments for format string', () => {
    const violations = check(`msg = "Hello %s, you are %d years old" % (name,)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/string-format-mismatch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag matching argument count', () => {
    const violations = check(`msg = "Hello %s" % (name,)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/string-format-mismatch');
    expect(matches).toHaveLength(0);
  });

  it('does not flag string without format placeholders', () => {
    const violations = check(`msg = "Hello world" % ()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/string-format-mismatch');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: duplicate-import
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/duplicate-import', () => {
  it('detects same module imported twice', () => {
    const violations = check(`
import os
import os
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag distinct imports', () => {
    const violations = check(`
import os
import sys
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-import');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: misleading-character-class
// ---------------------------------------------------------------------------

describe('bugs/deterministic/misleading-character-class', () => {
  it('detects multi-codepoint character in regex character class', () => {
    // emoji (U+1F600) inside a character class
    const violations = check('const re = /[😀]/;');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-character-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag ASCII-only character class', () => {
    const violations = check('const re = /[a-zA-Z0-9]/;');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-character-class');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex with no character class', () => {
    const violations = check('const re = /hello/;');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/misleading-character-class');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: race-condition-assignment
// ---------------------------------------------------------------------------

describe('bugs/deterministic/race-condition-assignment', () => {
  it('detects augmented assignment with await on right side', () => {
    const violations = check(`
async function foo() {
  counter += await getCount();
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/race-condition-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular assignment with await', () => {
    const violations = check(`
async function foo() {
  counter = await getCount();
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/race-condition-assignment');
    expect(matches).toHaveLength(0);
  });

  it('does not flag augmented assignment without await', () => {
    const violations = check(`
async function foo() {
  counter += 1;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/race-condition-assignment');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: regex-group-reference-mismatch
// ---------------------------------------------------------------------------

describe('bugs/deterministic/regex-group-reference-mismatch', () => {
  it('detects reference to non-existent capture group', () => {
    const violations = check(`const result = str.replace(/(foo)/, "$2");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/regex-group-reference-mismatch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag valid group reference', () => {
    const violations = check(`const result = str.replace(/(foo)/, "$1");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/regex-group-reference-mismatch');
    expect(matches).toHaveLength(0);
  });

  it('does not flag replace without regex', () => {
    const violations = check(`const result = str.replace("foo", "$2");`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/regex-group-reference-mismatch');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: duplicate-import
// ---------------------------------------------------------------------------

describe('bugs/deterministic/duplicate-import', () => {
  it('detects duplicate import of same module', () => {
    const violations = check(`
import { foo } from 'lodash';
import { bar } from 'lodash';
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag imports from different modules', () => {
    const violations = check(`
import { foo } from 'lodash';
import { bar } from 'ramda';
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/duplicate-import');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: constructor-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/constructor-return', () => {
  it('detects constructor returning a value', () => {
    const violations = check(`
class Foo {
  constructor() {
    return { x: 1 };
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constructor-return');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Constructor with return value');
  });

  it('does not flag constructor with bare return', () => {
    const violations = check(`
class Foo {
  constructor() {
    if (x) return;
    this.x = 1;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constructor-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-constructor methods with returns', () => {
    const violations = check(`
class Foo {
  getValue() {
    return 42;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/constructor-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: setter-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/setter-return', () => {
  it('detects setter returning a value', () => {
    const violations = check(`
class Foo {
  set value(v) {
    this._value = v;
    return v;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/setter-return');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Setter with return value');
  });

  it('does not flag setter with no return', () => {
    const violations = check(`
class Foo {
  set value(v) {
    this._value = v;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/setter-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag getters', () => {
    const violations = check(`
class Foo {
  get value() {
    return this._value;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/setter-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS: promise-executor-return
// ---------------------------------------------------------------------------

describe('bugs/deterministic/promise-executor-return', () => {
  it('detects return in Promise executor', () => {
    const violations = check(`
const p = new Promise((resolve, reject) => {
  return 42;
});
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/promise-executor-return');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Promise executor return');
  });

  it('does not flag Promise executor using resolve()', () => {
    const violations = check(`
const p = new Promise((resolve, reject) => {
  resolve(42);
});
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/promise-executor-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-Promise new expressions', () => {
    const violations = check(`
const x = new Foo((a, b) => {
  return a + b;
});
`);
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/promise-executor-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: exception-not-from-base-exception
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/exception-not-from-base-exception', () => {
  it('detects raising an integer literal', () => {
    const violations = check(`
raise 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-not-from-base-exception');
    expect(matches).toHaveLength(1);
  });

  it('detects raising a string literal', () => {
    const violations = check(`
raise "error message"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-not-from-base-exception');
    expect(matches).toHaveLength(1);
  });

  it('does not flag raising a proper exception', () => {
    const violations = check(`
raise ValueError("bad value")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-not-from-base-exception');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: invalid-special-method-return-type
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/invalid-special-method-return-type', () => {
  it('detects __len__ returning a string', () => {
    const violations = check(`
class Foo:
    def __len__(self):
        return "five"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-special-method-return-type');
    expect(matches).toHaveLength(1);
  });

  it('detects __str__ returning an integer', () => {
    const violations = check(`
class Foo:
    def __str__(self):
        return 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-special-method-return-type');
    expect(matches).toHaveLength(1);
  });

  it('does not flag __len__ returning an integer', () => {
    const violations = check(`
class Foo:
    def __len__(self):
        return 5
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-special-method-return-type');
    expect(matches).toHaveLength(0);
  });

  it('does not flag __bool__ returning True', () => {
    const violations = check(`
class Foo:
    def __bool__(self):
        return True
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-special-method-return-type');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: exception-group-misuse
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/exception-group-misuse', () => {
  it('detects ExceptionGroup caught with except*', () => {
    const violations = check(`
try:
    pass
except* ExceptionGroup:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-group-misuse');
    expect(matches).toHaveLength(1);
  });

  it('detects BaseExceptionGroup caught with except*', () => {
    const violations = check(`
try:
    pass
except* BaseExceptionGroup:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-group-misuse');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except* with regular exceptions', () => {
    const violations = check(`
try:
    pass
except* ValueError:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-group-misuse');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regular except ExceptionGroup', () => {
    const violations = check(`
try:
    pass
except ExceptionGroup:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/exception-group-misuse');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: unintentional-type-annotation
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/unintentional-type-annotation', () => {
  it('detects bare type annotation without assignment', () => {
    const violations = check(`
x: int
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unintentional-type-annotation');
    expect(matches).toHaveLength(1);
  });

  it('does not flag type annotation with assignment', () => {
    const violations = check(`
x: int = 5
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unintentional-type-annotation');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: star-arg-after-keyword
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/star-arg-after-keyword', () => {
  it('detects *args after keyword argument', () => {
    const violations = check(`
result = f(a=1, *args)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/star-arg-after-keyword');
    expect(matches).toHaveLength(1);
  });

  it('does not flag *args before keyword arguments', () => {
    const violations = check(`
result = f(*args, a=1)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/star-arg-after-keyword');
    expect(matches).toHaveLength(0);
  });

  it('does not flag calls without star args', () => {
    const violations = check(`
result = f(1, 2, a=3)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/star-arg-after-keyword');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: unreliable-callable-check
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/unreliable-callable-check', () => {
  it('detects hasattr(x, "__call__")', () => {
    const violations = check(`
if hasattr(obj, '__call__'):
    obj()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreliable-callable-check');
    expect(matches).toHaveLength(1);
  });

  it('does not flag callable(x)', () => {
    const violations = check(`
if callable(obj):
    obj()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreliable-callable-check');
    expect(matches).toHaveLength(0);
  });

  it('does not flag hasattr with other attribute names', () => {
    const violations = check(`
if hasattr(obj, 'method'):
    obj.method()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/unreliable-callable-check');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: strip-with-multi-chars
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/strip-with-multi-chars', () => {
  it('detects strip with multi-character string', () => {
    const violations = check(`
result = text.strip("abc")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/strip-with-multi-chars');
    expect(matches).toHaveLength(1);
  });

  it('detects lstrip with multi-character string', () => {
    const violations = check(`
result = text.lstrip("xyz")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/strip-with-multi-chars');
    expect(matches).toHaveLength(1);
  });

  it('does not flag strip with single character', () => {
    const violations = check(`
result = text.strip(" ")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/strip-with-multi-chars');
    expect(matches).toHaveLength(0);
  });

  it('does not flag strip with no arguments', () => {
    const violations = check(`
result = text.strip()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/strip-with-multi-chars');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: assert-false
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/assert-false', () => {
  it('detects assert False', () => {
    const violations = check(`
assert False, "This should never happen"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-false');
    expect(matches).toHaveLength(1);
  });

  it('does not flag assert True', () => {
    const violations = check(`
assert True
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-false');
    expect(matches).toHaveLength(0);
  });

  it('does not flag assert with a condition', () => {
    const violations = check(`
assert x > 0, "x must be positive"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-false');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: redundant-tuple-in-exception
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/redundant-tuple-in-exception', () => {
  it('detects except (ValueError,) with trailing comma', () => {
    const violations = check(`
try:
    x()
except (ValueError,):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/redundant-tuple-in-exception');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with two exception types', () => {
    const violations = check(`
try:
    x()
except (ValueError, TypeError):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/redundant-tuple-in-exception');
    expect(matches).toHaveLength(0);
  });

  it('does not flag plain except ValueError', () => {
    const violations = check(`
try:
    x()
except ValueError:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/redundant-tuple-in-exception');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: except-with-empty-tuple
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/except-with-empty-tuple', () => {
  it('detects except () that catches nothing', () => {
    const violations = check(`
try:
    x()
except ():
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/except-with-empty-tuple');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with types', () => {
    const violations = check(`
try:
    x()
except (ValueError, TypeError):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/except-with-empty-tuple');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: re-sub-positional-args
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/re-sub-positional-args', () => {
  it('detects re.sub with flag as 4th positional arg', () => {
    const violations = check(`
import re
result = re.sub(r"foo", "bar", text, re.IGNORECASE)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/re-sub-positional-args');
    expect(matches).toHaveLength(1);
  });

  it('does not flag re.sub with flag as keyword arg', () => {
    const violations = check(`
import re
result = re.sub(r"foo", "bar", text, flags=re.IGNORECASE)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/re-sub-positional-args');
    expect(matches).toHaveLength(0);
  });

  it('does not flag re.sub with 3 args', () => {
    const violations = check(`
import re
result = re.sub(r"foo", "bar", text)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/re-sub-positional-args');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: static-key-dict-comprehension
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/static-key-dict-comprehension', () => {
  it('detects dict comprehension with string literal key', () => {
    const violations = check(`
result = {"key": v for v in values}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/static-key-dict-comprehension');
    expect(matches).toHaveLength(1);
  });

  it('detects dict comprehension with integer key', () => {
    const violations = check(`
result = {0: v for v in values}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/static-key-dict-comprehension');
    expect(matches).toHaveLength(1);
  });

  it('does not flag dict comprehension with variable key', () => {
    const violations = check(`
result = {k: v for k, v in items.items()}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/static-key-dict-comprehension');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: fstring-docstring
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/fstring-docstring', () => {
  it('detects f-string used as function docstring', () => {
    const violations = check(`
def foo():
    f"This is a docstring"
    return 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fstring-docstring');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular string docstring', () => {
    const violations = check(`
def foo():
    """This is a real docstring"""
    return 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/fstring-docstring');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: useless-contextlib-suppress
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/useless-contextlib-suppress', () => {
  it('detects contextlib.suppress() with no arguments', () => {
    const violations = check(`
import contextlib
with contextlib.suppress():
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-contextlib-suppress');
    expect(matches).toHaveLength(1);
  });

  it('does not flag contextlib.suppress with exception types', () => {
    const violations = check(`
import contextlib
with contextlib.suppress(FileNotFoundError):
    os.remove("file.txt")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/useless-contextlib-suppress');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: nan-comparison
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/nan-comparison', () => {
  it('detects comparison with float("nan")', () => {
    const violations = check(`
if x == float("nan"):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/nan-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag math.isnan()', () => {
    const violations = check(`
import math
if math.isnan(x):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/nan-comparison');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regular float comparison', () => {
    const violations = check(`
if x == 3.14:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/nan-comparison');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: assignment-to-os-environ
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/assignment-to-os-environ', () => {
  it('detects os.environ = {...}', () => {
    const violations = check(`
import os
os.environ = {"KEY": "value"}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-to-os-environ');
    expect(matches).toHaveLength(1);
  });

  it('does not flag os.environ.update()', () => {
    const violations = check(`
import os
os.environ.update({"KEY": "value"})
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-to-os-environ');
    expect(matches).toHaveLength(0);
  });

  it('does not flag os.environ item assignment', () => {
    const violations = check(`
import os
os.environ["KEY"] = "value"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assignment-to-os-environ');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: assert-on-string-literal
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/assert-on-string-literal', () => {
  it('detects assert on string literal', () => {
    const violations = check(`
assert "this is always true"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-on-string-literal');
    expect(matches).toHaveLength(1);
  });

  it('does not flag assert with condition', () => {
    const violations = check(`
assert x > 0, "x must be positive"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/assert-on-string-literal');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: binary-op-exception
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/binary-op-exception', () => {
  it('detects except ValueError or TypeError', () => {
    const violations = check(`
try:
    x()
except ValueError or TypeError:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/binary-op-exception');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with tuple of types', () => {
    const violations = check(`
try:
    x()
except (ValueError, TypeError):
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/binary-op-exception');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: super-without-brackets
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/super-without-brackets', () => {
  it('detects super.method without parentheses', () => {
    const violations = check(`
class Child(Parent):
    def method(self):
        super.method(self)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/super-without-brackets');
    expect(matches).toHaveLength(1);
  });

  it('does not flag super().method with parentheses', () => {
    const violations = check(`
class Child(Parent):
    def method(self):
        super().method()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/super-without-brackets');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: yield-from-in-async
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/yield-from-in-async', () => {
  it('detects yield from inside async function', () => {
    const violations = check(`
async def foo():
    yield from some_generator()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/yield-from-in-async');
    expect(matches).toHaveLength(1);
  });

  it('does not flag yield from in regular function', () => {
    const violations = check(`
def foo():
    yield from some_generator()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/yield-from-in-async');
    expect(matches).toHaveLength(0);
  });

  it('does not flag plain yield in async function', () => {
    const violations = check(`
async def foo():
    yield 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/yield-from-in-async');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: invalid-all-object
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/invalid-all-object', () => {
  it('detects non-string in __all__', () => {
    const violations = check(`
__all__ = ["foo", bar, "baz"]
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-all-object');
    expect(matches).toHaveLength(1);
  });

  it('does not flag all-string __all__', () => {
    const violations = check(`
__all__ = ["foo", "bar", "baz"]
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-all-object');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty __all__', () => {
    const violations = check(`
__all__ = []
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/invalid-all-object');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: mutable-fromkeys-value
// ---------------------------------------------------------------------------

describe('Python: bugs/deterministic/mutable-fromkeys-value', () => {
  it('detects dict.fromkeys with list default', () => {
    const violations = check(`
result = dict.fromkeys(keys, [])
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-fromkeys-value');
    expect(matches).toHaveLength(1);
  });

  it('detects dict.fromkeys with dict default', () => {
    const violations = check(`
result = dict.fromkeys(keys, {})
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-fromkeys-value');
    expect(matches).toHaveLength(1);
  });

  it('does not flag dict.fromkeys with immutable default', () => {
    const violations = check(`
result = dict.fromkeys(keys, 0)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-fromkeys-value');
    expect(matches).toHaveLength(0);
  });

  it('does not flag dict.fromkeys with no default', () => {
    const violations = check(`
result = dict.fromkeys(keys)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'bugs/deterministic/mutable-fromkeys-value');
    expect(matches).toHaveLength(0);
  });
});
