import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES, CODE_RULES } from '../../packages/analyzer/src/rules/index';
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

describe('code-quality/deterministic/console-log', () => {
  it('detects console.log', () => {
    const violations = check(`console.log("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('console.log call');
  });

  it('detects console.debug', () => {
    const violations = check(`console.debug("debug info");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('console.debug call');
  });

  it('does not flag console.error', () => {
    const violations = check(`console.error("error");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(0);
  });

  it('does not flag console.warn', () => {
    const violations = check(`console.warn("warning");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/todo-fixme', () => {
  it('detects TODO comments', () => {
    const violations = check(`// TODO: fix this later`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('TODO comment');
  });

  it('detects FIXME comments', () => {
    const violations = check(`/* FIXME: broken logic */`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('FIXME comment');
  });

  it('detects HACK comments', () => {
    const violations = check(`// HACK: workaround for issue #123`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('HACK comment');
  });

  it('does not flag regular comments', () => {
    const violations = check(`// This function handles user authentication`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-explicit-any', () => {
  it('detects explicit any type annotations', () => {
    const violations = check(`function foo(x: any): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-explicit-any');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag specific types', () => {
    const violations = check(`function foo(x: string): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-explicit-any');
    expect(matches).toHaveLength(0);
  });

  it('does not flag unknown type', () => {
    const violations = check(`function foo(x: unknown): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-explicit-any');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/star-import', () => {
  it('detects namespace import in JS/TS', () => {
    const violations = check(`import * as utils from './utils';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag named imports', () => {
    const violations = check(`import { foo, bar } from './utils';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(0);
  });
});

describe('JS: code-quality/deterministic/global-statement (var)', () => {
  it('detects var inside function', () => {
    const violations = check(`function foo() { var x = 1; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-statement');
    expect(matches).toHaveLength(1);
  });

  it('does not flag let/const inside function', () => {
    const violations = check(`function foo() { let x = 1; const y = 2; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-statement');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// New deterministic rules — JS/TS
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/nested-ternary', () => {
  it('detects ternary inside ternary', () => {
    const violations = check(`const x = a ? (b ? c : d) : e;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-ternary');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Nested ternary expression');
  });

  it('does not flag simple ternary', () => {
    const violations = check(`const x = a ? b : c;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-ternary');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/nested-template-literal', () => {
  it('detects template literal inside template literal', () => {
    const code = 'const x = `hello ${`inner ${value}`}`;';
    const violations = check(code);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-template-literal');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple template literal', () => {
    const violations = check('const x = `hello ${name}`;');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-template-literal');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-return-statements', () => {
  it('detects function with more than 5 returns', () => {
    const violations = check(`
      function classify(x: number): string {
        if (x < 0) return "negative";
        if (x === 0) return "zero";
        if (x < 10) return "small";
        if (x < 100) return "medium";
        if (x < 1000) return "large";
        if (x < 10000) return "very-large";
        return "huge";
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-return-statements');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with 5 or fewer returns', () => {
    const violations = check(`
      function classify(x: number): string {
        if (x < 0) return "negative";
        if (x === 0) return "zero";
        if (x < 10) return "small";
        if (x < 100) return "medium";
        return "large";
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-return-statements');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/collapsible-if', () => {
  it('detects collapsible nested if in JS/TS', () => {
    const violations = check(`
      function foo(a: boolean, b: boolean) {
        if (a) {
          if (b) {
            doSomething();
          }
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if with else', () => {
    const violations = check(`
      function foo(a: boolean, b: boolean) {
        if (a) {
          if (b) {
            doSomething();
          }
        } else {
          doOther();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-if');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-boolean', () => {
  it('detects if returning true/false', () => {
    const violations = check(`
      function isPositive(x: number) {
        if (x > 0) { return true; } else { return false; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-boolean');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if returning different values', () => {
    const violations = check(`
      function getValue(x: number) {
        if (x > 0) { return 1; } else { return 0; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-boolean');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-else-after-return', () => {
  it('detects unnecessary else after return', () => {
    const violations = check(`
      function foo(x: number) {
        if (x > 0) {
          return x;
        } else {
          doSomething();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-else-after-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if without else', () => {
    const violations = check(`
      function foo(x: number) {
        if (x > 0) {
          return x;
        }
        doSomething();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-else-after-return');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-empty-function', () => {
  it('detects empty function in JS/TS', () => {
    const violations = check(`function foo() {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-empty-function');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with body', () => {
    const violations = check(`function foo() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-empty-function');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function with comment', () => {
    const violations = check(`function foo() { /* intentionally empty */ }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-empty-function');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-useless-catch', () => {
  it('detects catch that only re-throws', () => {
    const violations = check(`
      try {
        riskyOp();
      } catch (err) {
        throw err;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-useless-catch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag catch with additional logic', () => {
    const violations = check(`
      try {
        riskyOp();
      } catch (err) {
        logger.error(err);
        throw err;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-useless-catch');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-template-literal', () => {
  it('detects string + variable concatenation', () => {
    const violations = check(`const msg = "Hello " + name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template-literal');
    expect(matches).toHaveLength(1);
  });

  it('does not flag number addition', () => {
    const violations = check(`const sum = a + b;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template-literal');
    expect(matches).toHaveLength(0);
  });

  it('does not flag two string literals concatenated', () => {
    const violations = check(`const x = "hello" + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template-literal');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-var-declaration', () => {
  it('detects var declaration in JavaScript', () => {
    const violations = check(`var x = 1;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-var-declaration');
    expect(matches).toHaveLength(1);
  });

  it('detects var at module level (not just inside functions)', () => {
    const violations = check(`var count = 0;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-var-declaration');
    expect(matches).toHaveLength(1);
  });

  it('does not flag let/const', () => {
    const violations = check(`let x = 1; const y = 2;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-var-declaration');
    expect(matches).toHaveLength(0);
  });

  it('does not fire on TypeScript (JS only)', () => {
    const violations = check(`var x = 1;`, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-var-declaration');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

describe('code rules integration', () => {
  it('returns no violations for clean code', () => {
    const violations = check(`
      const MAX_RETRIES = 3;

      export async function fetchUser(id: string): Promise<User> {
        try {
          const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
          return result.rows[0];
        } catch (error) {
          logger.error("Failed to fetch user", { error, id });
          throw error;
        }
      }
    `);
    const significant = violations.filter(
      (v) => v.ruleKey !== 'code-quality/llm/magic-number',
    );
    expect(significant).toHaveLength(0);
  });

  it('detects multiple violations in problematic code', () => {
    const violations = check(`
      // TODO: clean this up
      try { riskyOp(); } catch (e) {}
      console.log("debugging");
      const apiKey = "sk_live_abc123defghijk";
    `);
    const ruleKeys = new Set(violations.map((v) => v.ruleKey));
    expect(ruleKeys.has('code-quality/deterministic/todo-fixme')).toBe(true);
    expect(ruleKeys.has('bugs/deterministic/empty-catch')).toBe(true);
    expect(ruleKeys.has('code-quality/deterministic/console-log')).toBe(true);
    expect(ruleKeys.has('security/deterministic/hardcoded-secret')).toBe(true);
  });

  it('respects disabled rules', () => {
    const rulesWithDisabled = ALL_DEFAULT_RULES.map((r) =>
      r.key === 'code-quality/deterministic/console-log' ? { ...r, enabled: false } : r,
    );
    const tree = parseCode(`console.log("test");`, 'typescript');
    const violations = checkCodeRules(tree, '/test.ts', `console.log("test");`, rulesWithDisabled, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/console-log (print)', () => {
  it('detects print() calls', () => {
    const violations = check(`print("hello world")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('print() call');
  });

  it('does not flag non-print calls', () => {
    const violations = check(`logger.info("hello")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/console-log');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/todo-fixme', () => {
  it('detects TODO comments', () => {
    const violations = check(`# TODO: fix this later\nx = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme');
    expect(matches).toHaveLength(1);
  });
});

describe('Python: code-quality/deterministic/star-import', () => {
  it('detects from module import *', () => {
    const violations = check(`from os import *`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag named imports', () => {
    const violations = check(`from os import path, getcwd`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/global-statement', () => {
  it('detects global inside function', () => {
    const violations = check(`
x = 0
def increment():
    global x
    x += 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-statement');
    expect(matches).toHaveLength(1);
  });

  it('does not flag global at module level', () => {
    const violations = check(`global x\nx = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-statement');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// New deterministic rules — Python
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/too-many-return-statements', () => {
  it('detects function with more than 5 returns', () => {
    const violations = check(`
def classify(x):
    if x < 0:
        return "negative"
    if x == 0:
        return "zero"
    if x < 10:
        return "small"
    if x < 100:
        return "medium"
    if x < 1000:
        return "large"
    if x < 10000:
        return "very-large"
    return "huge"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-return-statements');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with few returns', () => {
    const violations = check(`
def classify(x):
    if x < 0:
        return "negative"
    return "non-negative"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-return-statements');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/collapsible-if', () => {
  it('detects collapsible nested if', () => {
    const violations = check(`
def foo(a, b):
    if a:
        if b:
            do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if with else', () => {
    const violations = check(`
def foo(a, b):
    if a:
        if b:
            do_something()
    else:
        do_other()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-if');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/no-empty-function', () => {
  it('detects empty function with just pass', () => {
    const violations = check(`
def foo():
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-empty-function');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with body', () => {
    const violations = check(`
def foo():
    return 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-empty-function');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/unnecessary-else-after-return', () => {
  it('detects unnecessary else after return', () => {
    const violations = check(`
def foo(x):
    if x > 0:
        return x
    else:
        do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-else-after-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if without else', () => {
    const violations = check(`
def foo(x):
    if x > 0:
        return x
    do_something()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-else-after-return');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Language isolation
// ---------------------------------------------------------------------------

describe('code-quality: language isolation', () => {
  it('does not fire JS console.log visitor on Python code', () => {
    const violations = check(`console.log("test")`, 'python');
    const matches = violations.filter((v) => v.title === 'console.log call');
    expect(matches).toHaveLength(0);
  });

  it('does not fire Python print visitor on JS code', () => {
    const violations = check(`print("test")`, 'typescript');
    const matches = violations.filter((v) => v.title === 'print() call');
    expect(matches).toHaveLength(0);
  });
});
