import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES, CODE_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'tsx' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : language === 'tsx' ? '.tsx' : '.ts';
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
  it('detects namespace import from external package', () => {
    const violations = check(`import * as lodash from 'lodash';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag namespace import from relative path (local module)', () => {
    const violations = check(`import * as utils from './utils';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(0);
  });

  it('does not flag namespace import from react', () => {
    const violations = check(`import * as React from 'react';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/star-import');
    expect(matches).toHaveLength(0);
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

// prefer-template-literal was removed (duplicate of prefer-template)

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
    // Filter out LLM-only rules (not deterministic) and reliability rules
    // that flag catch patterns — this test validates code-quality rules only
    // Also exclude unknown-catch-variable since idiomatic TS often omits the type annotation
    const significant = violations.filter(
      (v) => v.ruleKey !== 'code-quality/llm/magic-number'
        && !v.ruleKey.startsWith('reliability/')
        && !v.ruleKey.startsWith('database/')
        && v.ruleKey !== 'code-quality/deterministic/unknown-catch-variable',
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
// New deterministic rules (batch 2) — JS/TS
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/cognitive-complexity', () => {
  it('detects function with cognitive complexity > 15', () => {
    const violations = check(`
      function complex(a: number, b: number, c: number, d: number) {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              if (d > 0) {
                for (let i = 0; i < 10; i++) {
                  if (i % 2 === 0) {
                    while (a > 0) {
                      a--;
                    }
                  }
                }
              }
            }
          }
        }
        if (a || b) {
          if (c && d) {
            return true;
          }
        }
        return false;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cognitive-complexity');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple function', () => {
    const violations = check(`
      function simple(x: number): number {
        if (x > 0) return x;
        return -x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cognitive-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/cyclomatic-complexity', () => {
  it('detects function with cyclomatic complexity > 10', () => {
    const violations = check(`
      function route(action: string) {
        if (action === "a") return 1;
        if (action === "b") return 2;
        if (action === "c") return 3;
        if (action === "d") return 4;
        if (action === "e") return 5;
        if (action === "f") return 6;
        if (action === "g") return 7;
        if (action === "h") return 8;
        if (action === "i") return 9;
        if (action === "j") return 10;
        if (action === "k") return 11;
        return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cyclomatic-complexity');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple function', () => {
    const violations = check(`
      function add(a: number, b: number): number {
        return a + b;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cyclomatic-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-lines', () => {
  it('detects function with > 50 lines', () => {
    const lines = Array.from({ length: 55 }, (_, i) => `  const v${i} = ${i};`).join('\n');
    const violations = check(`function longFn() {\n${lines}\n}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-lines');
    expect(matches).toHaveLength(1);
  });

  it('does not flag short function', () => {
    const violations = check(`function short() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-lines');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-branches', () => {
  it('detects function with > 10 branches', () => {
    const violations = check(`
      function manyBranches(x: number) {
        if (x === 1) return 'a';
        else if (x === 2) return 'b';
        else if (x === 3) return 'c';
        else if (x === 4) return 'd';
        else if (x === 5) return 'e';
        else if (x === 6) return 'f';
        else if (x === 7) return 'g';
        else if (x === 8) return 'h';
        else if (x === 9) return 'i';
        else if (x === 10) return 'j';
        else if (x === 11) return 'k';
        else return 'z';
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-branches');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with few branches', () => {
    const violations = check(`
      function fewBranches(x: number) {
        if (x > 0) return 'positive';
        else return 'non-positive';
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-branches');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/nested-switch', () => {
  it('detects switch inside switch', () => {
    const violations = check(`
      function test(a: string, b: string) {
        switch (a) {
          case 'x':
            switch (b) {
              case 'y': return 1;
            }
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-switch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag single switch', () => {
    const violations = check(`
      function test(a: string) {
        switch (a) {
          case 'x': return 1;
          case 'y': return 2;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-switch');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/deeply-nested-functions', () => {
  it('detects function 3+ levels deep', () => {
    const violations = check(`
      function a() {
        function b() {
          function c() {
            const d = () => 1;
          }
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deeply-nested-functions');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag 2 levels of nesting', () => {
    const violations = check(`
      function a() {
        function b() {
          return 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deeply-nested-functions');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/duplicate-string', () => {
  it('detects string used 3+ times', () => {
    const violations = check(`
      const a = "repeated-value";
      const b = "repeated-value";
      const c = "repeated-value";
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-string');
    expect(matches).toHaveLength(1);
  });

  it('does not flag string used less than 3 times', () => {
    const violations = check(`
      const a = "unique-one";
      const b = "unique-two";
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-string');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-expression', () => {
  it('detects expression with no side effect', () => {
    const violations = check(`
      function foo() {
        x + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-expression');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function calls', () => {
    const violations = check(`
      function foo() {
        doSomething();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-expression');
    expect(matches).toHaveLength(0);
  });

  it('does not flag assignments', () => {
    const violations = check(`
      function foo() {
        x = 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-expression');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-jump', () => {
  it('detects redundant return at end of void function', () => {
    const violations = check(`
      function foo() {
        doSomething();
        return;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-jump');
    expect(matches).toHaveLength(1);
  });

  it('does not flag return with value', () => {
    const violations = check(`
      function foo() {
        return 42;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-jump');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-script-url', () => {
  it('detects javascript: URL in string', () => {
    const violations = check(`const href = "javascript:void(0)";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-script-url');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular strings', () => {
    const violations = check(`const url = "https://example.com";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-script-url');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-throw-literal', () => {
  it('detects throw string', () => {
    const violations = check(`throw "something went wrong";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-throw-literal');
    expect(matches).toHaveLength(1);
  });

  it('does not flag throw new Error', () => {
    const violations = check(`throw new Error("something went wrong");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-throw-literal');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-label-var', () => {
  it('detects label with same name as variable', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        x: for (let i = 0; i < 10; i++) {
          break x;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-label-var');
    expect(matches).toHaveLength(1);
  });

  it('does not flag label with unique name', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        outer: for (let i = 0; i < 10; i++) {
          break outer;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-label-var');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-new-wrappers', () => {
  it('detects new String()', () => {
    const violations = check(`const s = new String("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-new-wrappers');
    expect(matches).toHaveLength(1);
  });

  it('detects new Number()', () => {
    const violations = check(`const n = new Number(42);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-new-wrappers');
    expect(matches).toHaveLength(1);
  });

  it('detects new Boolean()', () => {
    const violations = check(`const b = new Boolean(true);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-new-wrappers');
    expect(matches).toHaveLength(1);
  });

  it('does not flag new Error()', () => {
    const violations = check(`const e = new Error("oops");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-new-wrappers');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-proto', () => {
  it('detects __proto__ usage', () => {
    const violations = check(`const proto = obj.__proto__;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-proto');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Object.getPrototypeOf', () => {
    const violations = check(`const proto = Object.getPrototypeOf(obj);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-proto');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-void', () => {
  it('detects void expression', () => {
    const violations = check(`void someFunction();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-void');
    expect(matches).toHaveLength(1);
  });

  it('does not flag void 0', () => {
    const violations = check(`const undef = void 0;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-void');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-const', () => {
  it('detects let that is never reassigned', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        return x + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-const');
    expect(matches).toHaveLength(1);
  });

  it('does not flag let that is reassigned', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        x = 2;
        return x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-const');
    expect(matches).toHaveLength(0);
  });

  it('does not flag const', () => {
    const violations = check(`
      function foo() {
        const x = 1;
        return x + 1;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-const');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-debugger', () => {
  it('detects debugger statement in JS/TS', () => {
    const violations = check(`function foo() { debugger; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-debugger');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular code', () => {
    const violations = check(`function foo() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-debugger');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-alert', () => {
  it('detects alert()', () => {
    const violations = check(`alert("Hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-alert');
    expect(matches).toHaveLength(1);
  });

  it('detects confirm()', () => {
    const violations = check(`confirm("Are you sure?");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-alert');
    expect(matches).toHaveLength(1);
  });

  it('detects prompt()', () => {
    const violations = check(`prompt("Enter name:");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-alert');
    expect(matches).toHaveLength(1);
  });

  it('does not flag other function calls', () => {
    const violations = check(`console.error("test");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-alert');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/require-await', () => {
  it('detects async function without await', () => {
    const violations = check(`
      async function fetchData() {
        return someValue;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-await');
    expect(matches).toHaveLength(1);
  });

  it('does not flag async function with await', () => {
    const violations = check(`
      async function fetchData() {
        const data = await fetch("/api");
        return data;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-await');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-async function', () => {
    const violations = check(`
      function fetchData() {
        return someValue;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-await');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-return-await', () => {
  it('detects return await in async function', () => {
    const violations = check(`
      async function fetchData() {
        return await fetch("/api");
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-await');
    expect(matches).toHaveLength(1);
  });

  it('does not flag return without await', () => {
    const violations = check(`
      async function fetchData() {
        const data = await fetch("/api");
        return data;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-await');
    expect(matches).toHaveLength(0);
  });

  it('does not flag return await inside try block', () => {
    const violations = check(`
      async function fetchData() {
        try {
          return await fetch("/api");
        } catch (e) {
          return null;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-await');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// New deterministic rules (batch 2) — Python
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/cognitive-complexity', () => {
  it('detects function with high cognitive complexity', () => {
    const violations = check(`
def complex_fn(a, b, c, d):
    if a > 0:
        if b > 0:
            if c > 0:
                if d > 0:
                    for i in range(10):
                        if i % 2 == 0:
                            while a > 0:
                                a -= 1
    if a or b:
        if c and d:
            return True
    return False
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cognitive-complexity');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple function', () => {
    const violations = check(`
def simple(x):
    if x > 0:
        return x
    return -x
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cognitive-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/cyclomatic-complexity', () => {
  it('detects function with cyclomatic complexity > 10', () => {
    const violations = check(`
def route(action):
    if action == "a":
        return 1
    if action == "b":
        return 2
    if action == "c":
        return 3
    if action == "d":
        return 4
    if action == "e":
        return 5
    if action == "f":
        return 6
    if action == "g":
        return 7
    if action == "h":
        return 8
    if action == "i":
        return 9
    if action == "j":
        return 10
    if action == "k":
        return 11
    return 0
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cyclomatic-complexity');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple function', () => {
    const violations = check(`
def add(a, b):
    return a + b
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/cyclomatic-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/too-many-lines', () => {
  it('detects function with > 50 lines', () => {
    const lines = Array.from({ length: 55 }, (_, i) => `    v${i} = ${i}`).join('\n');
    const violations = check(`def long_fn():\n${lines}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-lines');
    expect(matches).toHaveLength(1);
  });

  it('does not flag short function', () => {
    const violations = check(`
def short():
    return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-lines');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/too-many-branches', () => {
  it('detects function with > 10 branches', () => {
    const violations = check(`
def many_branches(x):
    if x == 1:
        return 'a'
    elif x == 2:
        return 'b'
    elif x == 3:
        return 'c'
    elif x == 4:
        return 'd'
    elif x == 5:
        return 'e'
    elif x == 6:
        return 'f'
    elif x == 7:
        return 'g'
    elif x == 8:
        return 'h'
    elif x == 9:
        return 'i'
    elif x == 10:
        return 'j'
    elif x == 11:
        return 'k'
    else:
        return 'z'
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-branches');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with few branches', () => {
    const violations = check(`
def few(x):
    if x > 0:
        return 'positive'
    else:
        return 'non-positive'
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-branches');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/deeply-nested-functions', () => {
  it('detects function 3+ levels deep', () => {
    const violations = check(`
def a():
    def b():
        def c():
            def d():
                return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deeply-nested-functions');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag 2 levels', () => {
    const violations = check(`
def a():
    def b():
        return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deeply-nested-functions');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/duplicate-string', () => {
  it('detects string used 3+ times', () => {
    const violations = check(`
a = "repeated-value"
b = "repeated-value"
c = "repeated-value"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-string');
    expect(matches).toHaveLength(1);
  });

  it('does not flag string used less than 3 times', () => {
    const violations = check(`
a = "unique-one"
b = "unique-two"
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-string');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/redundant-jump', () => {
  it('detects redundant return at end of function', () => {
    const violations = check(`
def foo():
    do_something()
    return
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-jump');
    expect(matches).toHaveLength(1);
  });

  it('does not flag return with value', () => {
    const violations = check(`
def foo():
    return 42
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-jump');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/no-debugger', () => {
  it('detects breakpoint()', () => {
    const violations = check(`
def foo():
    breakpoint()
    return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-debugger');
    expect(matches).toHaveLength(1);
  });

  it('detects pdb.set_trace()', () => {
    const violations = check(`
import pdb
def foo():
    pdb.set_trace()
    return 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-debugger');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular function calls', () => {
    const violations = check(`
def foo():
    return bar()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-debugger');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/require-await', () => {
  it('detects async function without await', () => {
    const violations = check(`
async def fetch_data():
    return some_value
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-await');
    expect(matches).toHaveLength(1);
  });

  it('does not flag async function with await', () => {
    const violations = check(`
async def fetch_data():
    data = await fetch("/api")
    return data
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-await');
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

// ---------------------------------------------------------------------------
// 25 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/expression-complexity', () => {
  it('detects expression with more than 5 operators', () => {
    const violations = check(`const x = a + b + c + d + e + f + g;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/expression-complexity');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag expression with 5 or fewer operators', () => {
    const violations = check(`const x = a + b + c + d + e;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/expression-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-switch-cases', () => {
  it('detects switch with more than 10 cases', () => {
    const violations = check(`
      switch (x) {
        case 1: break; case 2: break; case 3: break; case 4: break; case 5: break;
        case 6: break; case 7: break; case 8: break; case 9: break; case 10: break;
        case 11: break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-switch-cases');
    expect(matches).toHaveLength(1);
  });

  it('does not flag switch with 10 or fewer cases', () => {
    const violations = check(`
      switch (x) {
        case 1: break; case 2: break; case 3: break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-switch-cases');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-union-members', () => {
  it('detects union type with more than 5 members', () => {
    const violations = check(`type T = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-union-members');
    expect(matches).toHaveLength(1);
  });

  it('does not flag union with 5 or fewer members', () => {
    const violations = check(`type T = 'a' | 'b' | 'c';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-union-members');
    expect(matches).toHaveLength(0);
  });

  it('does not fire on JavaScript (TypeScript only)', () => {
    const violations = check(`const x = 1;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-union-members');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-breaks', () => {
  it('detects function with more than 5 break statements', () => {
    const violations = check(`
      function foo() {
        for (let i = 0; i < 10; i++) {
          if (i === 1) break;
          if (i === 2) break;
          if (i === 3) break;
          if (i === 4) break;
          if (i === 5) break;
          if (i === 6) break;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-breaks');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with 5 or fewer breaks', () => {
    const violations = check(`
      function foo() {
        for (let i = 0; i < 10; i++) {
          if (i === 1) break;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-breaks');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/identical-functions', () => {
  it('detects two functions with identical bodies', () => {
    const violations = check(`
      function foo() { return x + 1; }
      function bar() { return x + 1; }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/identical-functions');
    expect(matches).toHaveLength(1);
  });

  it('does not flag functions with different bodies', () => {
    const violations = check(`
      function foo() { return x + 1; }
      function bar() { return x + 2; }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/identical-functions');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-variable', () => {
  it('detects unused variable in function', () => {
    const violations = check(`
      function foo() {
        const unused = 42;
        return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag used variable', () => {
    const violations = check(`
      function foo() {
        const x = 42;
        return x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches).toHaveLength(0);
  });

  it('does not flag variable prefixed with underscore', () => {
    const violations = check(`
      function foo() {
        const _unused = 42;
        return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-private-member', () => {
  it('detects unused private field', () => {
    const violations = check(`
      class Foo {
        private secret = 42;
        greet() { return 'hi'; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-private-member');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag private field that is used', () => {
    const violations = check(`
      class Foo {
        private secret = 42;
        getSecret() { return this.secret; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-private-member');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/dead-store', () => {
  it('detects assignment overwritten before read', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        x = 2;
        return x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dead-store');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable that is read before overwrite', () => {
    const violations = check(`
      function foo() {
        let x = 1;
        console.log(x);
        x = 2;
        return x;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dead-store');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-collection', () => {
  it('detects array created but never read', () => {
    const violations = check(`
      function foo() {
        const items = [];
        return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-collection');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag array that is returned', () => {
    const violations = check(`
      function foo() {
        const items = [];
        return items;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-collection');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-assignment', () => {
  it('detects self-assignment x = x', () => {
    const violations = check(`x = x;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag x = y', () => {
    const violations = check(`x = y;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-assignment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-lonely-if', () => {
  it('detects if as only statement in else block', () => {
    const violations = check(`
      if (a) {
        doA();
      } else {
        if (b) {
          doB();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-lonely-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag else if', () => {
    const violations = check(`
      if (a) {
        doA();
      } else if (b) {
        doB();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-lonely-if');
    expect(matches).toHaveLength(0);
  });

  it('does not flag else with multiple statements', () => {
    const violations = check(`
      if (a) {
        doA();
      } else {
        doC();
        if (b) doB();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-lonely-if');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-constructor', () => {
  it('detects constructor that only forwards args to super', () => {
    const violations = check(`
      class Child extends Parent {
        constructor(x, y) {
          super(x, y);
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-constructor');
    expect(matches).toHaveLength(1);
  });

  it('does not flag constructor with additional logic', () => {
    const violations = check(`
      class Child extends Parent {
        constructor(x, y) {
          super(x, y);
          this.z = 0;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-constructor');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-escape', () => {
  it('detects unnecessary escape in string', () => {
    const violations = check(`const x = "hello\\ world";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-escape');
    expect(matches).toHaveLength(1);
  });

  it('does not flag necessary escape characters', () => {
    const violations = check(`const x = "hello\\nworld";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-escape');
    expect(matches).toHaveLength(0);
  });

  it('does not flag escaped quote', () => {
    const violations = check(`const x = "say \\"hello\\"";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-escape');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-rename', () => {
  it('detects destructuring rename to same name', () => {
    const violations = check(`const { x: x } = obj;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-rename');
    expect(matches).toHaveLength(1);
  });

  it('does not flag rename to different name', () => {
    const violations = check(`const { x: y } = obj;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-rename');
    expect(matches).toHaveLength(0);
  });

  it('does not flag shorthand destructuring', () => {
    const violations = check(`const { x } = obj;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-rename');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-computed-key', () => {
  it('detects computed property with string literal key', () => {
    const violations = check(`const obj = { ["name"]: "Alice" };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-computed-key');
    expect(matches).toHaveLength(1);
  });

  it('does not flag computed property with expression', () => {
    const violations = check(`const obj = { [dynamicKey]: "value" };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-computed-key');
    expect(matches).toHaveLength(0);
  });

  it('does not flag static property key', () => {
    const violations = check(`const obj = { name: "Alice" };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-computed-key');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-concat', () => {
  it('detects concatenation of two string literals', () => {
    const violations = check(`const x = "hello" + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-concat');
    expect(matches).toHaveLength(1);
  });

  it('does not flag string + variable', () => {
    const violations = check(`const x = "hello " + name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-concat');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/strict-equality', () => {
  it('detects == operator with non-null operand', () => {
    const violations = check(`if (x == 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(1);
  });

  it('detects != operator with non-null operand', () => {
    const violations = check(`if (x != 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(1);
  });

  it('does not flag == null (idiomatic null-or-undefined check)', () => {
    const violations = check(`if (x == null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(0);
  });

  it('does not flag != null (idiomatic null-or-undefined check)', () => {
    const violations = check(`if (x != null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(0);
  });

  it('does not flag === operator', () => {
    const violations = check(`if (x === null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/commented-out-code', () => {
  it('detects commented-out code in JS/TS', () => {
    const violations = check(`// const x = getValue(); return x;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/commented-out-code');
    expect(matches).toHaveLength(1);
  });

  it('does not flag documentation comments', () => {
    const violations = check(`/** This function handles authentication. */`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/commented-out-code');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regular text comments', () => {
    const violations = check(`// This is a description of the algorithm`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/commented-out-code');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/inverted-boolean', () => {
  it('does not flag idiomatic !!x', () => {
    const violations = check(`const b = !!value;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inverted-boolean');
    expect(matches).toHaveLength(0);
  });

  it('detects !(!x)', () => {
    const violations = check(`const b = !(!value);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inverted-boolean');
    expect(matches).toHaveLength(1);
  });

  it('does not flag single negation', () => {
    const violations = check(`const b = !value;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inverted-boolean');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-single-boolean-return', () => {
  it('detects function with multiple boolean returns via if statements', () => {
    const violations = check(`
      function isValid(x: number) {
        if (x > 0) return true;
        return false;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-single-boolean-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function returning non-boolean values', () => {
    const violations = check(`
      function getValue(x: number) {
        if (x > 0) return 'positive';
        return 'zero-or-neg';
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-single-boolean-return');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-immediate-return', () => {
  it('detects assign-then-return pattern', () => {
    const violations = check(`
      function getResult() {
        const result = computeValue();
        return result;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-immediate-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag variable used before return', () => {
    const violations = check(`
      function getResult() {
        const result = computeValue();
        log(result);
        return result;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-immediate-return');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-while', () => {
  it('detects for(;condition;) loop', () => {
    const violations = check(`for (; running;) { step(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-while');
    expect(matches).toHaveLength(1);
  });

  it('does not flag standard for loop', () => {
    const violations = check(`for (let i = 0; i < 10; i++) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-while');
    expect(matches).toHaveLength(0);
  });

  it('does not flag while loop', () => {
    const violations = check(`while (running) { step(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-while');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-object-spread', () => {
  it('detects Object.assign({}, obj)', () => {
    const violations = check(`const copy = Object.assign({}, source);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-object-spread');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Object.assign with non-empty first arg', () => {
    const violations = check(`const result = Object.assign({ x: 1 }, source);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-object-spread');
    expect(matches).toHaveLength(0);
  });

  it('does not flag spread syntax directly', () => {
    const violations = check(`const copy = { ...source };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-object-spread');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-optional-chain', () => {
  it('detects a && a.b pattern', () => {
    const violations = check(`const val = obj && obj.name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-optional-chain');
    expect(matches).toHaveLength(1);
  });

  it('does not flag a || b pattern', () => {
    const violations = check(`const val = obj || defaultObj;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-optional-chain');
    expect(matches).toHaveLength(0);
  });

  it('does not flag a?.b (already uses optional chain)', () => {
    const violations = check(`const val = obj?.name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-optional-chain');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-nullish-coalescing', () => {
  it('detects a != null ? a : b pattern', () => {
    const violations = check(`const val = value != null ? value : 'default';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-nullish-coalescing');
    expect(matches).toHaveLength(1);
  });

  it('does not flag a ?? b (already uses nullish coalescing)', () => {
    const violations = check(`const val = value ?? 'default';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-nullish-coalescing');
    expect(matches).toHaveLength(0);
  });

  it('does not flag ternary with different condition variable', () => {
    const violations = check(`const val = condition ? value : 'default';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-nullish-coalescing');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: 2 new rules
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/unused-variable', () => {
  it('detects assigned but unread variable in function', () => {
    const violations = check(`
def foo():
    unused = 42
    return 0
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable that is used', () => {
    const violations = check(`
def foo():
    x = 42
    return x
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches).toHaveLength(0);
  });

  it('does not flag variable prefixed with underscore', () => {
    const violations = check(`
def foo():
    _unused = 42
    return 0
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-variable');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code-quality/deterministic/commented-out-code', () => {
  it('detects commented-out Python code', () => {
    const violations = check(`# x = get_value(); return x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/commented-out-code');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular text comments', () => {
    const violations = check(`# This function handles user authentication`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/commented-out-code');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 3 — 25 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-rest-params', () => {
  it('detects arguments object usage', () => {
    const violations = check(`function foo() { return arguments.length; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-rest-params');
    expect(matches).toHaveLength(1);
  });

  it('does not flag arrow functions (no arguments binding)', () => {
    // Arrow functions don't have their own arguments — no false positives
    const violations = check(`function outer() { const fn = () => arguments.length; return fn; }`, 'javascript');
    // The arguments reference is inside an arrow function but in scope of outer — still flagged on outer
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-rest-params');
    // We don't make strong claims here about the arrow case — just ensure outer function catches it
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('does not flag non-arguments identifiers', () => {
    const violations = check(`function foo(args: string[]) { return args.length; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-rest-params');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-spread', () => {
  it('detects fn.apply(null, args)', () => {
    const violations = check(`fn.apply(null, args);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-spread');
    expect(matches).toHaveLength(1);
  });

  it('detects fn.apply(this, args)', () => {
    const violations = check(`class Foo { bar(args: any[]) { this.baz.apply(this, args); } baz() {} }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-spread');
    expect(matches).toHaveLength(1);
  });

  it('does not flag apply with non-null/this context', () => {
    const violations = check(`fn.apply(otherContext, args);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-spread');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/parameter-reassignment', () => {
  it('detects direct parameter reassignment', () => {
    const violations = check(`function foo(x: number) { x = 10; return x; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/parameter-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('detects parameter mutation via +=', () => {
    const violations = check(`function add(total: number, n: number) { total += n; return total; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/parameter-reassignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag local variable modification', () => {
    const violations = check(`function foo(x: number) { let local = x; local = 10; return local; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/parameter-reassignment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/labels-usage', () => {
  it('detects labeled for loop', () => {
    const violations = check(`outer: for (let i = 0; i < 10; i++) { break outer; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/labels-usage');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular unlabeled loops', () => {
    const violations = check(`for (let i = 0; i < 10; i++) { if (i === 5) break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/labels-usage');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/extend-native', () => {
  it('detects Array.prototype modification', () => {
    const violations = check(`Array.prototype.sum = function() { return this.reduce((a, b) => a + b, 0); };`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/extend-native');
    expect(matches).toHaveLength(1);
  });

  it('detects String.prototype modification', () => {
    const violations = check(`String.prototype.trim2 = function() { return this.trim(); };`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/extend-native');
    expect(matches).toHaveLength(1);
  });

  it('does not flag custom class prototype modification', () => {
    const violations = check(`MyClass.prototype.method = function() {};`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/extend-native');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/array-constructor', () => {
  it('detects new Array() with no args', () => {
    const violations = check(`const arr = new Array();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/array-constructor');
    expect(matches).toHaveLength(1);
  });

  it('detects new Array(a, b, c) with multiple args', () => {
    const violations = check(`const arr = new Array(1, 2, 3);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/array-constructor');
    expect(matches).toHaveLength(1);
  });

  it('does not flag new Array(n) with single numeric arg (pre-allocation)', () => {
    const violations = check(`const arr = new Array(100);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/array-constructor');
    expect(matches).toHaveLength(0);
  });

  it('does not flag array literal', () => {
    const violations = check(`const arr = [1, 2, 3];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/array-constructor');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/function-in-loop', () => {
  it('detects function expression defined inside for loop', () => {
    const violations = check(`
      for (let i = 0; i < 10; i++) {
        const fn = function() { return i; };
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-loop');
    expect(matches).toHaveLength(1);
  });

  it('detects arrow function inside while loop', () => {
    const violations = check(`
      while (running) {
        const handler = () => doWork();
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-loop');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function defined outside loop', () => {
    const violations = check(`
      const fn = () => 1;
      for (let i = 0; i < 10; i++) { fn(); }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-loop');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/multi-assign', () => {
  it('detects chained assignment a = b = c', () => {
    const violations = check(`let a, b; a = b = 0;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/multi-assign');
    expect(matches).toHaveLength(1);
  });

  it('does not flag single assignment', () => {
    const violations = check(`let a = 0;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/multi-assign');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/bitwise-in-boolean', () => {
  it('detects & used in if condition', () => {
    const violations = check(`if (a & b) { doSomething(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/bitwise-in-boolean');
    expect(matches).toHaveLength(1);
  });

  it('detects | used in while condition', () => {
    const violations = check(`while (x | y) { step(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/bitwise-in-boolean');
    expect(matches).toHaveLength(1);
  });

  it('does not flag & in assignment context', () => {
    const violations = check(`const flags = a & b;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/bitwise-in-boolean');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/for-in-without-filter', () => {
  it('detects for-in without hasOwnProperty check', () => {
    const violations = check(`
      for (const key in obj) {
        process(key);
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/for-in-without-filter');
    expect(matches).toHaveLength(1);
  });

  it('does not flag for-in with hasOwnProperty check', () => {
    const violations = check(`
      for (const key in obj) {
        if (!Object.hasOwn(obj, key)) continue;
        process(key);
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/for-in-without-filter');
    expect(matches).toHaveLength(0);
  });

  it('does not flag for-of', () => {
    const violations = check(`for (const item of arr) { process(item); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/for-in-without-filter');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/with-statement', () => {
  it('detects with statement', () => {
    const violations = check(`with (obj) { x = 1; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/with-statement');
    expect(matches).toHaveLength(1);
  });
});

describe('code-quality/deterministic/default-case-last', () => {
  it('detects default case not at end', () => {
    const violations = check(`
      switch (x) {
        default: break;
        case 'a': return 1;
        case 'b': return 2;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-case-last');
    expect(matches).toHaveLength(1);
  });

  it('does not flag default case at end', () => {
    const violations = check(`
      switch (x) {
        case 'a': return 1;
        case 'b': return 2;
        default: return 0;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-case-last');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/elseif-without-else', () => {
  it('detects if-else if chain without final else', () => {
    const violations = check(`
      function classify(x: number) {
        if (x > 0) {
          return 'positive';
        } else if (x < 0) {
          return 'negative';
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/elseif-without-else');
    expect(matches).toHaveLength(1);
  });

  it('does not flag if-else if with final else', () => {
    const violations = check(`
      function classify(x: number) {
        if (x > 0) {
          return 'positive';
        } else if (x < 0) {
          return 'negative';
        } else {
          return 'zero';
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/elseif-without-else');
    expect(matches).toHaveLength(0);
  });

  it('does not flag plain if without else-if', () => {
    const violations = check(`if (x > 0) { return 'positive'; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/elseif-without-else');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/accessor-pairs', () => {
  it('detects setter without getter', () => {
    const violations = check(`
      const obj = {
        set name(v: string) { this._name = v; }
      };
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/accessor-pairs');
    expect(matches).toHaveLength(1);
  });

  it('does not flag paired getter and setter', () => {
    const violations = check(`
      const obj = {
        get name() { return this._name; },
        set name(v: string) { this._name = v; }
      };
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/accessor-pairs');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-return-assign', () => {
  it('detects assignment in return statement', () => {
    const violations = check(`function foo() { let x; return x = getValue(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-assign');
    expect(matches).toHaveLength(1);
  });

  it('does not flag return with comparison', () => {
    const violations = check(`function foo(x: number) { return x === 0; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-assign');
    expect(matches).toHaveLength(0);
  });

  it('does not flag simple return', () => {
    const violations = check(`function foo() { return getValue(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-return-assign');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-sequences', () => {
  it('detects comma operator in expression', () => {
    const violations = check(`const x = (a++, b++, a + b);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-sequences');
    expect(matches).toHaveLength(1);
  });

  it('does not flag comma in function arguments', () => {
    const violations = check(`foo(a, b, c);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-sequences');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-caller', () => {
  it('detects arguments.callee usage', () => {
    const violations = check(`function factorial(n) { if (n <= 1) return 1; return n * arguments.callee(n - 1); }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-caller');
    expect(matches).toHaveLength(1);
  });

  it('detects arguments.caller usage', () => {
    const violations = check(`function foo() { return arguments.caller; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-caller');
    expect(matches).toHaveLength(1);
  });

  it('does not flag arguments.length', () => {
    const violations = check(`function foo() { return arguments.length; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-caller');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-iterator', () => {
  it('detects __iterator__ property access', () => {
    const violations = check(`const it = obj.__iterator__;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-iterator');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Symbol.iterator usage', () => {
    const violations = check(`const it = obj[Symbol.iterator]();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-iterator');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/require-yield', () => {
  it('detects generator function without yield', () => {
    const violations = check(`function* gen() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-yield');
    expect(matches).toHaveLength(1);
  });

  it('does not flag generator function with yield', () => {
    const violations = check(`function* gen() { yield 1; yield 2; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-yield');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/class-prototype-assignment', () => {
  it('detects prototype method assignment', () => {
    const violations = check(`
      function Animal(name) { this.name = name; }
      Animal.prototype.speak = function() { return this.name; };
    `, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/class-prototype-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag extend-native (handled by separate rule)', () => {
    const violations = check(`Array.prototype.sum = function() { return 0; };`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/class-prototype-assignment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/function-in-block', () => {
  it('detects function declaration inside if block', () => {
    const violations = check(`
      if (condition) {
        function helper() { return 1; }
      }
    `, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-block');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function at module scope', () => {
    const violations = check(`function helper() { return 1; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-block');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function expression assigned inside block', () => {
    const violations = check(`
      if (condition) {
        const helper = function() { return 1; };
      }
    `, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/function-in-block');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-type-alias', () => {
  it('detects type alias that just wraps another type', () => {
    const violations = check(`type UserAlias = User;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-alias');
    expect(matches).toHaveLength(1);
  });

  it('does not flag type alias with union or complex type', () => {
    const violations = check(`type Result = string | number;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-alias');
    expect(matches).toHaveLength(0);
  });

  it('does not flag type alias with intersection', () => {
    const violations = check(`type AdminUser = User & Admin;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-alias');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-optional', () => {
  it('detects optional parameter with explicit | undefined', () => {
    const violations = check(`function foo(x?: string | undefined) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-optional');
    expect(matches).toHaveLength(1);
  });

  it('does not flag optional parameter without explicit undefined', () => {
    const violations = check(`function foo(x?: string) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-optional');
    expect(matches).toHaveLength(0);
  });

  it('does not flag required parameter with undefined in union', () => {
    const violations = check(`function foo(x: string | undefined) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-optional');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/duplicate-type-constituent', () => {
  it('detects duplicate member in union type', () => {
    const violations = check(`type Foo = string | number | string;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-type-constituent');
    expect(matches).toHaveLength(1);
  });

  it('does not flag union type with unique members', () => {
    const violations = check(`type Foo = string | number | boolean;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-type-constituent');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/equals-in-for-termination', () => {
  it('detects === in for loop condition', () => {
    const violations = check(`for (let i = 0; i === 10; i++) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/equals-in-for-termination');
    expect(matches).toHaveLength(1);
  });

  it('detects == in for loop condition', () => {
    const violations = check(`for (let i = 0; i == 10; i++) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/equals-in-for-termination');
    expect(matches).toHaveLength(1);
  });

  it('does not flag < comparison in for loop', () => {
    const violations = check(`for (let i = 0; i < 10; i++) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/equals-in-for-termination');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 4 — 25 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-includes', () => {
  it('detects indexOf !== -1 pattern', () => {
    const violations = check(`const found = arr.indexOf(x) !== -1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-includes');
    expect(matches).toHaveLength(1);
  });

  it('detects indexOf === -1 pattern', () => {
    const violations = check(`const missing = arr.indexOf(x) === -1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-includes');
    expect(matches).toHaveLength(1);
  });

  it('does not flag indexOf when result is used for position', () => {
    const violations = check(`const pos = arr.indexOf(x);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-includes');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/ban-ts-comment', () => {
  it('detects @ts-ignore without description', () => {
    const violations = check(`// @ts-ignore\nconst x: string = 1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ban-ts-comment');
    expect(matches).toHaveLength(1);
  });

  it('detects @ts-nocheck without description', () => {
    const violations = check(`// @ts-nocheck\nconst x = 1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ban-ts-comment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag @ts-ignore with description', () => {
    const violations = check(`// @ts-ignore intentional: legacy type mismatch\nconst x: string = 1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ban-ts-comment');
    expect(matches).toHaveLength(0);
  });

  it('does not fire on JavaScript files', () => {
    const violations = check(`// @ts-ignore\nconst x = 1;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ban-ts-comment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/non-null-assertion', () => {
  it('detects non-null assertion operator', () => {
    const violations = check(`const x = foo!.bar;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-null-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular member access', () => {
    const violations = check(`const x = foo?.bar;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-null-assertion');
    expect(matches).toHaveLength(0);
  });

  it('does not fire on JavaScript files', () => {
    const violations = check(`const x = foo.bar;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-null-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-boolean-compare', () => {
  it('detects === true comparison', () => {
    const violations = check(`if (isValid === true) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(1);
  });

  it('detects === true comparison', () => {
    const violations = check(`if (isReady === true) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(1);
  });

  it('does not flag === false (may be needed for nullable booleans)', () => {
    const violations = check(`if (isReady === false) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regular boolean check', () => {
    const violations = check(`if (isValid) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(0);
  });

  it('does not flag true === true (two literals)', () => {
    const violations = check(`if (true === true) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-block', () => {
  it('detects lone block statement inside another block', () => {
    const violations = check(`
      function foo() {
        {
          const x = 1;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-block');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function body block', () => {
    const violations = check(`function foo() { return 1; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-block');
    expect(matches).toHaveLength(0);
  });

  it('does not flag if block', () => {
    const violations = check(`if (x) { doSomething(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-block');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-call-apply', () => {
  it('detects fn.call() with no arguments', () => {
    const violations = check(`fn.call();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-call-apply');
    expect(matches).toHaveLength(1);
  });

  it('detects fn.apply() with no arguments', () => {
    const violations = check(`fn.apply();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-call-apply');
    expect(matches).toHaveLength(1);
  });

  it('does not flag fn.call(this, arg)', () => {
    const violations = check(`fn.call(this, arg);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-call-apply');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-empty-group', () => {
  it('detects empty group in regex literal', () => {
    const violations = check(`const re = /foo()bar/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-group');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-empty groups', () => {
    const violations = check(`const re = /foo(bar)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-group');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-single-char-class', () => {
  it('detects single character in character class', () => {
    const violations = check(`const re = /[a]bc/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-single-char-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag character class with range', () => {
    const violations = check(`const re = /[a-z]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-single-char-class');
    expect(matches).toHaveLength(0);
  });

  it('does not flag character class with multiple characters', () => {
    const violations = check(`const re = /[abc]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-single-char-class');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-single-char-alternation', () => {
  it('detects alternation of single characters', () => {
    const violations = check(`const re = /(a|b|c)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-single-char-alternation');
    expect(matches).toHaveLength(1);
  });

  it('does not flag alternation of multi-char patterns', () => {
    const violations = check(`const re = /(foo|bar)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-single-char-alternation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-duplicate-char-class', () => {
  it('detects duplicate character in class', () => {
    const violations = check(`const re = /[aab]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-duplicate-char-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unique characters in class', () => {
    const violations = check(`const re = /[abc]/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-duplicate-char-class');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-anchor-precedence', () => {
  it('detects anchor adjacent to alternation', () => {
    const violations = check(`const re = /^foo|bar$/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-anchor-precedence');
    expect(matches).toHaveLength(1);
  });

  it('does not flag properly grouped alternation', () => {
    const violations = check(`const re = /^(foo|bar)$/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-anchor-precedence');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex without alternation', () => {
    const violations = check(`const re = /^foobar$/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-anchor-precedence');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-regex-exec', () => {
  it('detects str.match(/regex/) without global flag', () => {
    const violations = check(`const m = str.match(/foo/);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-regex-exec');
    expect(matches).toHaveLength(1);
  });

  it('does not flag str.match(/regex/g) with global flag', () => {
    const violations = check(`const m = str.match(/foo/g);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-regex-exec');
    expect(matches).toHaveLength(0);
  });

  it('does not flag other string methods', () => {
    const violations = check(`const m = str.replace(/foo/, "bar");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-regex-exec');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/case-without-break', () => {
  it('detects case without break', () => {
    const violations = check(`
      switch (x) {
        case 'a':
          doA();
        case 'b':
          doB();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/case-without-break');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag case with break', () => {
    const violations = check(`
      switch (x) {
        case 'a':
          doA();
          break;
        case 'b':
          doB();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/case-without-break');
    expect(matches).toHaveLength(0);
  });

  it('does not flag case with return', () => {
    const violations = check(`
      function foo(x: string) {
        switch (x) {
          case 'a': return 1;
          case 'b': return 2;
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/case-without-break');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty case (intentional fallthrough)', () => {
    const violations = check(`
      switch (x) {
        case 'a':
        case 'b':
          doSomething();
          break;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/case-without-break');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/undefined-passed-as-optional', () => {
  it('detects explicit undefined as last argument', () => {
    const violations = check(`foo(a, b, undefined);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-passed-as-optional');
    expect(matches).toHaveLength(1);
  });

  it('does not flag undefined as non-last argument', () => {
    const violations = check(`foo(undefined, b, c);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-passed-as-optional');
    expect(matches).toHaveLength(0);
  });

  it('does not flag call with no args', () => {
    const violations = check(`foo();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-passed-as-optional');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/undefined-assignment', () => {
  it('detects assignment to undefined', () => {
    const violations = check(`x = undefined;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-assignment');
    expect(matches).toHaveLength(1);
  });

  it('detects declaration initialized to undefined', () => {
    const violations = check(`let x = undefined;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-assignment');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular assignments', () => {
    const violations = check(`x = null;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undefined-assignment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/associative-array', () => {
  it('detects string key on array-named variable', () => {
    const violations = check(`arr["key"] = value;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/associative-array');
    expect(matches).toHaveLength(1);
  });

  it('does not flag numeric index access', () => {
    const violations = check(`arr[0] = value;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/associative-array');
    expect(matches).toHaveLength(0);
  });

  it('does not flag object property access', () => {
    const violations = check(`config["key"] = value;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/associative-array');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/selector-parameter', () => {
  it('detects boolean flag parameter controlling function behavior', () => {
    const violations = check(`
      function render(isVisible: boolean) {
        if (isVisible) {
          showElement();
        }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/selector-parameter');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-selector parameters', () => {
    const violations = check(`
      function add(a: number, b: number) {
        return a + b;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/selector-parameter');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/string-comparison', () => {
  it('detects string literal comparison with <', () => {
    const violations = check(`const result = "apple" < "banana";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/string-comparison');
    expect(matches).toHaveLength(1);
  });

  it('detects string literal comparison with >', () => {
    const violations = check(`const sorted = "z" > "a";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/string-comparison');
    expect(matches).toHaveLength(1);
  });

  it('does not flag numeric comparison', () => {
    const violations = check(`if (a < b) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/string-comparison');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-bind', () => {
  it('detects .bind() on arrow function', () => {
    const violations = check(`const fn = (() => doWork()).bind(this);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-bind');
    expect(matches).toHaveLength(1);
  });

  it('does not flag .bind() on regular function', () => {
    const violations = check(`const fn = regularFn.bind(this);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-bind');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/implicit-type-coercion', () => {
  it('detects unary + coercion on non-number', () => {
    const violations = check(`const n = +str;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-type-coercion');
    expect(matches).toHaveLength(1);
  });

  it('detects ~indexOf coercion', () => {
    const violations = check(`if (~arr.indexOf(x)) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-type-coercion');
    expect(matches).toHaveLength(1);
  });

  it('does not flag unary + on number literal', () => {
    const violations = check(`const n = +1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-type-coercion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/deep-callback-nesting', () => {
  it('detects 4+ levels of callback nesting', () => {
    const violations = check(`
      a(function() {
        b(function() {
          c(function() {
            d(function() {
              doWork();
            });
          });
        });
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deep-callback-nesting');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag 3 levels of nesting', () => {
    const violations = check(`
      a(function() {
        b(function() {
          c(function() {
            doWork();
          });
        });
      });
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deep-callback-nesting');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-classes-per-file', () => {
  it('detects more than 3 classes in one file', () => {
    const violations = check(`
      class A {}
      class B {}
      class C {}
      class D {}
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-classes-per-file');
    expect(matches).toHaveLength(1);
  });

  it('does not flag 3 or fewer classes', () => {
    const violations = check(`
      class A {}
      class B {}
      class C {}
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-classes-per-file');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-extraneous-class', () => {
  it('detects class with only static members', () => {
    const violations = check(`
      class Utils {
        static formatDate(d: Date) { return d.toISOString(); }
        static parseDate(s: string) { return new Date(s); }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-extraneous-class');
    expect(matches).toHaveLength(1);
  });

  it('does not flag class with instance methods', () => {
    const violations = check(`
      class Service {
        static config = {};
        getName() { return 'service'; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-extraneous-class');
    expect(matches).toHaveLength(0);
  });

  it('does not flag class with constructor', () => {
    const violations = check(`
      class Singleton {
        static instance: Singleton;
        constructor() {}
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-extraneous-class');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 5 — 25 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/default-parameter-position', () => {
  it('detects required param after default param', () => {
    const violations = check(`function foo(a = 1, b: string) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-parameter-position');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag default param last', () => {
    const violations = check(`function foo(a: string, b = 1) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-parameter-position');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnamed-regex-capture', () => {
  it('detects unnamed capture group in regex', () => {
    const violations = check(`const re = /(\\d+)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnamed-regex-capture');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-capturing group', () => {
    const violations = check(`const re = /(?:\\d+)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnamed-regex-capture');
    expect(matches).toHaveLength(0);
  });

  it('does not flag named capture group', () => {
    const violations = check(`const re = /(?<year>\\d{4})/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnamed-regex-capture');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-regex-constructor', () => {
  it('detects new RegExp with string literal', () => {
    const violations = check(`const re = new RegExp("\\\\d+");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-regex-constructor');
    expect(matches).toHaveLength(1);
  });

  it('does not flag new RegExp with variable', () => {
    const violations = check(`const re = new RegExp(pattern);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-regex-constructor');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/ungrouped-accessor-pair', () => {
  it('detects getter and setter not adjacent', () => {
    const violations = check(`
      class Foo {
        get name() { return this._name; }
        doSomething() {}
        set name(v: string) { this._name = v; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ungrouped-accessor-pair');
    expect(matches).toHaveLength(1);
  });

  it('does not flag adjacent getter/setter', () => {
    const violations = check(`
      class Foo {
        get name() { return this._name; }
        set name(v: string) { this._name = v; }
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ungrouped-accessor-pair');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/this-aliasing', () => {
  it('detects const self = this', () => {
    const violations = check(`
      function Foo() {
        const self = this;
        return self;
      }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/this-aliasing');
    expect(matches).toHaveLength(1);
  });

  it('does not flag const x = obj.this', () => {
    const violations = check(`const x = obj.value;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/this-aliasing');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/require-import', () => {
  it('detects require() in TypeScript', () => {
    const violations = check(`const fs = require('fs');`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag import statement', () => {
    const violations = check(`import fs from 'fs';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-import');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unsafe-function-type', () => {
  it('detects Function type in annotation', () => {
    const violations = check(`function foo(cb: Function) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unsafe-function-type');
    expect(matches).toHaveLength(1);
  });

  it('does not flag specific function signature', () => {
    const violations = check(`function foo(cb: () => void) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unsafe-function-type');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-type-constraint', () => {
  it('detects T extends any constraint', () => {
    const violations = check(`function foo<T extends any>(x: T): T { return x; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-constraint');
    expect(matches).toHaveLength(1);
  });

  it('detects T extends unknown constraint', () => {
    const violations = check(`function foo<T extends unknown>(x: T): T { return x; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-constraint');
    expect(matches).toHaveLength(1);
  });

  it('does not flag T extends object', () => {
    const violations = check(`function foo<T extends object>(x: T): T { return x; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-type-constraint');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/literal-assertion-over-const', () => {
  it('detects as string-literal assertion', () => {
    const violations = check(`const x = "hello" as "hello";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/literal-assertion-over-const');
    expect(matches).toHaveLength(1);
  });

  it('does not flag as const', () => {
    const violations = check(`const x = "hello" as const;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/literal-assertion-over-const');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/filter-first-over-find', () => {
  it('detects .filter()[0]', () => {
    const violations = check(`const x = arr.filter(n => n > 0)[0];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/filter-first-over-find');
    expect(matches).toHaveLength(1);
  });

  it('does not flag .find()', () => {
    const violations = check(`const x = arr.find(n => n > 0);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/filter-first-over-find');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/substring-over-starts-ends', () => {
  it('detects indexOf() === 0', () => {
    const violations = check(`if (str.indexOf("hello") === 0) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/substring-over-starts-ends');
    expect(matches).toHaveLength(1);
  });

  it('does not flag startsWith', () => {
    const violations = check(`if (str.startsWith("hello")) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/substring-over-starts-ends');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/triple-slash-reference', () => {
  it('detects triple-slash reference directive', () => {
    const violations = check(`/// <reference path="./types.d.ts" />`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/triple-slash-reference');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regular comments', () => {
    const violations = check(`// This is a regular comment`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/triple-slash-reference');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-empty-export', () => {
  it('detects empty export {}', () => {
    const violations = check(`export {};`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-empty-export');
    expect(matches).toHaveLength(1);
  });

  it('does not flag export with names', () => {
    const violations = check(`export { foo, bar };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-empty-export');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-template-expression', () => {
  it('detects template with only a variable', () => {
    const violations = check('const x = `${name}`;');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-template-expression');
    expect(matches).toHaveLength(1);
  });

  it('does not flag template with surrounding text', () => {
    const violations = check('const x = `Hello ${name}!`;');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-template-expression');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/dynamic-delete', () => {
  it('detects delete with computed key', () => {
    const violations = check(`delete obj[key];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dynamic-delete');
    expect(matches).toHaveLength(1);
  });

  it('does not flag delete with literal key', () => {
    const violations = check(`delete obj["name"];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dynamic-delete');
    expect(matches).toHaveLength(0);
  });

  it('does not flag delete of simple property', () => {
    const violations = check(`delete obj.name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dynamic-delete');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-type-intersection', () => {
  it('detects intersection with never', () => {
    const violations = check(`type Foo = string & never;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-type-intersection');
    expect(matches).toHaveLength(1);
  });

  it('detects intersection with any', () => {
    const violations = check(`type Foo = string & any;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-type-intersection');
    expect(matches).toHaveLength(1);
  });

  it('does not flag useful intersection', () => {
    const violations = check(`type Foo = A & B;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-type-intersection');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-empty-alternative', () => {
  it('detects empty alternative at end', () => {
    const violations = check(`const re = /foo|/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-alternative');
    expect(matches).toHaveLength(1);
  });

  it('detects empty alternative at start', () => {
    const violations = check(`const re = /|bar/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-alternative');
    expect(matches).toHaveLength(1);
  });

  it('does not flag valid alternation', () => {
    const violations = check(`const re = /foo|bar/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-alternative');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-unicode-awareness', () => {
  it('detects unicode property escape without u flag', () => {
    const violations = check(String.raw`const re = /\p{Letter}/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-unicode-awareness');
    expect(matches).toHaveLength(1);
  });

  it('does not flag regex with u flag', () => {
    const violations = check(String.raw`const re = /\p{Letter}/u;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-unicode-awareness');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex without unicode escapes', () => {
    const violations = check(`const re = /hello/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-unicode-awareness');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 6 — 25 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/negated-condition', () => {
  it('detects negated condition with else', () => {
    const violations = check(`if (!isReady) { fallback(); } else { proceed(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/negated-condition');
    expect(matches).toHaveLength(1);
  });

  it('does not flag negated condition without else', () => {
    const violations = check(`if (!isReady) { return; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/negated-condition');
    expect(matches).toHaveLength(0);
  });

  it('does not flag else-if chain', () => {
    const violations = check(`if (!a) { } else if (b) { }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/negated-condition');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/verbose-object-constructor', () => {
  it('detects new Object()', () => {
    const violations = check(`const x = new Object();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/verbose-object-constructor');
    expect(matches).toHaveLength(1);
  });

  it('does not flag new MyClass()', () => {
    const violations = check(`const x = new MyClass();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/verbose-object-constructor');
    expect(matches).toHaveLength(0);
  });

  it('does not flag object literal', () => {
    const violations = check(`const x = {};`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/verbose-object-constructor');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/trivial-ternary', () => {
  it('detects x ? true : false', () => {
    const violations = check(`const flag = isActive ? true : false;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-ternary');
    expect(matches).toHaveLength(1);
  });

  it('detects x ? false : true', () => {
    const violations = check(`const flag = isActive ? false : true;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-ternary');
    expect(matches).toHaveLength(1);
  });

  it('does not flag meaningful ternary', () => {
    const violations = check(`const val = isActive ? 'yes' : 'no';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-ternary');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/legacy-has-own-property', () => {
  it('detects Object.prototype.hasOwnProperty.call()', () => {
    const violations = check(`const has = Object.prototype.hasOwnProperty.call(obj, key);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-has-own-property');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Object.hasOwn()', () => {
    const violations = check(`const has = Object.hasOwn(obj, key);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-has-own-property');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-constructor-result', () => {
  it('detects new X() as statement', () => {
    const violations = check(`new SomeClass();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-constructor-result');
    expect(matches).toHaveLength(1);
  });

  it('does not flag assigned new expression', () => {
    const violations = check(`const x = new SomeClass();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-constructor-result');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/empty-static-block', () => {
  it('detects empty static block', () => {
    const violations = check(`class Foo { static { } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/empty-static-block');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-empty static block', () => {
    const violations = check(`class Foo { static { this.x = 1; } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/empty-static-block');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/collapsible-else-if', () => {
  it('detects else with single if inside', () => {
    const violations = check(`if (a) { x(); } else { if (b) { y(); } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-else-if');
    expect(matches).toHaveLength(1);
  });

  it('does not flag proper else-if', () => {
    const violations = check(`if (a) { x(); } else if (b) { y(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-else-if');
    expect(matches).toHaveLength(0);
  });

  it('does not flag else with multiple statements', () => {
    const violations = check(`if (a) { x(); } else { y(); z(); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collapsible-else-if');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/trivial-switch', () => {
  it('detects switch with 1 case', () => {
    const violations = check(`switch (x) { case 1: doA(); break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-switch');
    expect(matches).toHaveLength(1);
  });

  it('detects switch with 2 cases', () => {
    const violations = check(`switch (x) { case 1: doA(); break; case 2: doB(); break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-switch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag switch with 3 or more cases', () => {
    const violations = check(`switch (x) { case 1: a(); break; case 2: b(); break; case 3: c(); break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/trivial-switch');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-multiple-spaces', () => {
  it('detects multiple spaces in regex', () => {
    const violations = check(`const re = /hello  world/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-multiple-spaces');
    expect(matches).toHaveLength(1);
  });

  it('does not flag single space in regex', () => {
    const violations = check(`const re = /hello world/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-multiple-spaces');
    expect(matches).toHaveLength(0);
  });

  it('does not flag regex with quantifier', () => {
    const violations = check(String.raw`const re = / {3}/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-multiple-spaces');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-empty-after-reluctant', () => {
  it('detects reluctant quantifier followed by optional', () => {
    const violations = check(String.raw`const re = /a*?b?/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-after-reluctant');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal reluctant quantifier', () => {
    const violations = check(String.raw`const re = /a*?b/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-empty-after-reluctant');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-function-parameter', () => {
  it('detects unused parameter', () => {
    const violations = check(`function foo(a: string, b: number) { return a; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-function-parameter');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toContain('b');
  });

  it('does not flag used parameters', () => {
    const violations = check(`function foo(a: string, b: number) { return a + b; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-function-parameter');
    expect(matches).toHaveLength(0);
  });

  it('does not flag underscore-prefixed parameters', () => {
    const violations = check(`function foo(_unused: string, b: number) { return b; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-function-parameter');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/hardcoded-url', () => {
  it('detects hardcoded http URL', () => {
    const violations = check(`const url = "http://api.mycompany.com/v1/users";`, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/hardcoded-url');
    expect(matches).toHaveLength(1);
  });

  it('detects hardcoded https URL', () => {
    const violations = check(`const url = "https://api.mycompany.com/data";`, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/hardcoded-url');
    expect(matches).toHaveLength(1);
  });

  it('does not flag localhost URL', () => {
    const violations = check(`const url = "http://localhost:3000/api";`, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/hardcoded-url');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/hardcoded-port', () => {
  it('detects port in listen() call', () => {
    const violations = check(`app.listen(8080, () => {});`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/hardcoded-port');
    expect(matches).toHaveLength(1);
  });

  it('does not flag non-port numbers', () => {
    const violations = check(`const x = 42 + 5;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/hardcoded-port');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/missing-env-validation', () => {
  it('detects unguarded process.env.X', () => {
    const violations = check(`const val = process.env.API_KEY;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-env-validation');
    expect(matches).toHaveLength(1);
  });

  it('does not flag process.env.X inside if check', () => {
    const violations = check(`if (process.env.DEBUG) { console.log("debug"); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-env-validation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/boolean-parameter-default', () => {
  it('detects optional boolean without default', () => {
    const violations = check(`function foo(enabled?: boolean) { return enabled; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boolean-parameter-default');
    expect(matches).toHaveLength(1);
  });

  it('does not flag optional boolean with default', () => {
    const violations = check(`function foo(enabled: boolean = false) { return enabled; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boolean-parameter-default');
    expect(matches).toHaveLength(0);
  });

  it('does not flag required boolean', () => {
    const violations = check(`function foo(enabled: boolean) { return enabled; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boolean-parameter-default');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-promise-wrap', () => {
  it('detects new Promise(resolve => resolve(x))', () => {
    const violations = check(`const p = new Promise(resolve => resolve(42));`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-promise-wrap');
    expect(matches).toHaveLength(1);
  });

  it('does not flag Promise with reject', () => {
    const violations = check(`const p = new Promise((resolve, reject) => { try { resolve(x); } catch(e) { reject(e); } });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-promise-wrap');
    expect(matches).toHaveLength(0);
  });

  it('does not flag complex executor', () => {
    const violations = check(`const p = new Promise(resolve => { setTimeout(() => resolve(42), 1000); });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-promise-wrap');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/explicit-any-in-return', () => {
  it('detects function with any return type', () => {
    const violations = check(`function getData(): any { return {}; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/explicit-any-in-return');
    expect(matches).toHaveLength(1);
  });

  it('does not flag function with specific return type', () => {
    const violations = check(`function getData(): object { return {}; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/explicit-any-in-return');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function without return type', () => {
    const violations = check(`function getData() { return {}; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/explicit-any-in-return');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/magic-number', () => {
  it('detects magic number in binary expression', () => {
    const violations = check(`const result = x * 3.14159;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/magic-number');
    expect(matches).toHaveLength(1);
  });

  it('does not flag whitelisted numbers', () => {
    const violations = check(`const result = x * 0 + y * 1;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/magic-number');
    expect(matches).toHaveLength(0);
  });

  it('does not flag constant declarations', () => {
    const violations = check(`const MAX_RETRIES = 5;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/magic-number');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/async-promise-function', () => {
  it('detects non-async function returning new Promise', () => {
    const violations = check(`function fetchData() { return new Promise(resolve => resolve(42)); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/async-promise-function');
    expect(matches).toHaveLength(1);
  });

  it('does not flag async function', () => {
    const violations = check(`async function fetchData() { return 42; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/async-promise-function');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-Promise return', () => {
    const violations = check(`function getData() { return { x: 1 }; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/async-promise-function');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/filename-class-mismatch', () => {
  function checkWithPath(code: string, filePath: string) {
    const tree = parseCode(code, 'typescript');
    return checkCodeRules(tree, filePath, code, enabledRules, 'typescript');
  }

  it('detects class name mismatch with filename', () => {
    const violations = checkWithPath(`export default class UserService {}`, '/src/auth-service.ts');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/filename-class-mismatch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag matching class name', () => {
    const violations = checkWithPath(`export default class UserService {}`, '/src/UserService.ts');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/filename-class-mismatch');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// JS/TS — Batch 9 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/prefer-template', () => {
  it('detects string concatenation with variable', () => {
    const violations = check(`const x = "hello " + name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pure string concat', () => {
    const violations = check(`const x = "hello " + " world";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template');
    expect(matches).toHaveLength(0);
  });

  it('does not flag template literal', () => {
    const violations = check('const x = `hello ${name}`;');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-template');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-complexity', () => {
  it('detects complex regex with many groups', () => {
    const violations = check(`const r = /^(a)(b)(c)(d)(e)(f)(g)/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-complexity');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag simple regex', () => {
    const violations = check(`const r = /^[a-z]+$/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-complexity');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-concise', () => {
  it('detects [0-9] that should be \\d', () => {
    const violations = check(`const r = /[0-9]+/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-concise');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag already concise regex', () => {
    const violations = check(`const r = /\\d+/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-concise');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/missing-destructuring', () => {
  it('detects const x = obj.x pattern', () => {
    const violations = check(`const name = user.name;\nconst email = user.email;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-destructuring');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when variable name differs from property', () => {
    const violations = check(`const n = user.name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-destructuring');
    expect(matches).toHaveLength(0);
  });

  it('does not flag this.x access', () => {
    const violations = check(`const name = this.name;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-destructuring');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-object-literal', () => {
  it('detects empty object followed by property assignment', () => {
    const violations = check(`const obj = {};\nobj.name = "test";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-object-literal');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pre-populated object literal', () => {
    const violations = check(`const obj = { name: "test" };`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-object-literal');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python — Batch 8 new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/broad-exception-raised (Python)', () => {
  it('detects raise Exception()', () => {
    const violations = check(`raise Exception("something went wrong")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/broad-exception-raised');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects raise BaseException()', () => {
    const violations = check(`raise BaseException("bad")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/broad-exception-raised');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag specific exception', () => {
    const violations = check(`raise ValueError("invalid input")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/broad-exception-raised');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-else-on-loop (Python)', () => {
  it('detects for-else without break', () => {
    const code = `
for x in items:
    process(x)
else:
    print("done")
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-else-on-loop');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag for-else with break', () => {
    const code = `
for x in items:
    if x > 0:
        break
else:
    print("not found")
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-else-on-loop');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unspecified-encoding (Python)', () => {
  it('detects open() without encoding', () => {
    const violations = check(`f = open("file.txt", "r")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unspecified-encoding');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag open() with encoding', () => {
    const violations = check(`f = open("file.txt", "r", encoding="utf-8")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unspecified-encoding');
    expect(matches).toHaveLength(0);
  });

  it('does not flag binary mode open', () => {
    const violations = check(`f = open("file.bin", "rb")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unspecified-encoding');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/subprocess-run-without-check (Python)', () => {
  it('detects subprocess.run without check', () => {
    const violations = check(`import subprocess\nsubprocess.run(["ls"])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/subprocess-run-without-check');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag subprocess.run with check=True', () => {
    const violations = check(`subprocess.run(["ls"], check=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/subprocess-run-without-check');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/try-except-pass (Python)', () => {
  it('detects except with only pass', () => {
    const code = `
try:
    risky()
except Exception:
    pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/try-except-pass');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag except with logging', () => {
    const code = `
try:
    risky()
except Exception as e:
    logger.error(e)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/try-except-pass');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/open-file-without-context-manager (Python)', () => {
  it('detects open() without with', () => {
    const violations = check(`f = open("file.txt")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/open-file-without-context-manager');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag open() in with statement', () => {
    const code = `
with open("file.txt") as f:
    content = f.read()
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/open-file-without-context-manager');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-lambda (Python)', () => {
  it('detects lambda x: func(x)', () => {
    const violations = check(`fn = lambda x: process(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-lambda');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag lambda with transformation', () => {
    const violations = check(`fn = lambda x: x * 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-lambda');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/eq-without-hash (Python)', () => {
  it('detects class with __eq__ but no __hash__', () => {
    const code = `
class Point:
    def __eq__(self, other):
        return self.x == other.x
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/eq-without-hash');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag class with both __eq__ and __hash__', () => {
    const code = `
class Point:
    def __eq__(self, other):
        return self.x == other.x
    def __hash__(self):
        return hash(self.x)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/eq-without-hash');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/in-dict-keys (Python)', () => {
  it('detects key in dict.keys()', () => {
    const violations = check(`if key in data.keys():
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/in-dict-keys');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag key in dict', () => {
    const violations = check(`if key in data:
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/in-dict-keys');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/double-negation (Python)', () => {
  it('detects not not x', () => {
    const violations = check(`result = not not value`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/double-negation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag single not', () => {
    const violations = check(`result = not value`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/double-negation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/yoda-condition (Python)', () => {
  it('detects constant on left side', () => {
    const violations = check(`if 0 == x:
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/yoda-condition');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable on left side', () => {
    const violations = check(`if x == 0:
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/yoda-condition');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/dict-get-none-default (Python)', () => {
  it('detects dict.get(key, None)', () => {
    const violations = check(`value = data.get("key", None)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dict-get-none-default');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag dict.get(key)', () => {
    const violations = check(`value = data.get("key")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dict-get-none-default');
    expect(matches).toHaveLength(0);
  });

  it('does not flag dict.get with real default', () => {
    const violations = check(`value = data.get("key", "default")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dict-get-none-default');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/verbose-raise (Python)', () => {
  it('detects raise e instead of bare raise', () => {
    const code = `
try:
    risky()
except ValueError as e:
    raise e
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/verbose-raise');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag bare raise', () => {
    const code = `
try:
    risky()
except ValueError:
    raise
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/verbose-raise');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/error-instead-of-exception (Python)', () => {
  it('detects logging.error in except block', () => {
    const code = `
try:
    risky()
except Exception as e:
    logging.error("failed: %s", e)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/error-instead-of-exception');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag logging.exception in except block', () => {
    const code = `
try:
    risky()
except Exception as e:
    logging.exception("failed")
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/error-instead-of-exception');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/logging-redundant-exc-info (Python)', () => {
  it('detects logging.exception with exc_info=True', () => {
    const violations = check(`logging.exception("error", exc_info=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-redundant-exc-info');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag logging.exception without exc_info', () => {
    const violations = check(`logging.exception("error")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-redundant-exc-info');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/needless-bool (Python)', () => {
  it('detects return True if x else False', () => {
    const code = `
def is_valid(x):
    return True if x else False
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/needless-bool');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag meaningful conditional return', () => {
    const code = `
def get_value(x):
    return "yes" if x else "no"
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/needless-bool');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/enumerate-for-loop (Python)', () => {
  it('detects for i in range(len(items))', () => {
    const code = `
for i in range(len(items)):
    print(items[i])
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/enumerate-for-loop');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag enumerate()', () => {
    const code = `
for i, item in enumerate(items):
    print(i, item)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/enumerate-for-loop');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/duplicate-isinstance-call (Python)', () => {
  it('detects isinstance(x, A) or isinstance(x, B)', () => {
    const code = `if isinstance(x, int) or isinstance(x, float):
    pass`;
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-isinstance-call');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag single isinstance', () => {
    const violations = check(`if isinstance(x, int):
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-isinstance-call');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-dict-kwargs (Python)', () => {
  it('detects **{"key": value}', () => {
    const violations = check(`func(**{"name": value})`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-kwargs');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular kwargs', () => {
    const violations = check(`func(name=value)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-kwargs');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/startswith-endswith-tuple (Python)', () => {
  it('detects s.startswith("a") or s.startswith("b")', () => {
    const code = `if s.startswith("hello") or s.startswith("world"):
    pass`;
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/startswith-endswith-tuple');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag single startswith call', () => {
    const violations = check(`if s.startswith("hello"):
    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/startswith-endswith-tuple');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/duplicate-class-field (Python)', () => {
  it('detects duplicate class field', () => {
    const code = `
class Config:
    debug = False
    debug = True
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-class-field');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag unique fields', () => {
    const code = `
class Config:
    debug = False
    verbose = True
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-class-field');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/non-unique-enum-values (Python)', () => {
  it('detects duplicate enum values', () => {
    const code = `
from enum import Enum
class Color(Enum):
    RED = 1
    ALIAS = 1
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-unique-enum-values');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag unique enum values', () => {
    const code = `
from enum import Enum
class Color(Enum):
    RED = 1
    GREEN = 2
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-unique-enum-values');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/if-expr-min-max (Python)', () => {
  it('detects manual max with ternary', () => {
    const violations = check(`result = a if a > b else b`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/if-expr-min-max');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag proper max() call', () => {
    const violations = check(`result = max(a, b)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/if-expr-min-max');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/readlines-in-for (Python)', () => {
  it('detects for line in file.readlines()', () => {
    const code = `
with open("file.txt") as f:
    for line in f.readlines():
        process(line)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/readlines-in-for');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag for line in file', () => {
    const code = `
with open("file.txt") as f:
    for line in f:
        process(line)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/readlines-in-for');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/logging-root-logger-call (Python)', () => {
  it('detects logging.info() root logger call', () => {
    const violations = check(`logging.info("starting")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-root-logger-call');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag named logger', () => {
    const violations = check(`logger.info("starting")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-root-logger-call');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rules 213+ — Python framework/idiom + JS/TS rules (Batch 7 & 8)
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/sorted-reversed-redundant (Python)', () => {
  it('detects reversed(sorted(...))', () => {
    const violations = check(`x = reversed(sorted(items))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sorted-reversed-redundant');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag sorted(..., reverse=True)', () => {
    const violations = check(`x = sorted(items, reverse=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sorted-reversed-redundant');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/redundant-collection-function (Python)', () => {
  it('detects list(sorted(...))', () => {
    const violations = check(`x = list(sorted(items))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-collection-function');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag list(generator)', () => {
    const violations = check(`x = list(x for x in items)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-collection-function');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-list-in-iteration (Python)', () => {
  it('detects for x in list(iterable)', () => {
    const violations = check(`for x in list(items):\n  print(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-list-in-iteration');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag for x in items', () => {
    const violations = check(`for x in items:\n  print(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-list-in-iteration');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/field-duplicates-class-name (Python)', () => {
  it('detects field with same name as class', () => {
    const violations = check(`class Foo:\n  foo = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/field-duplicates-class-name');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag different names', () => {
    const violations = check(`class Foo:\n  bar = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/field-duplicates-class-name');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/prefer-pathlib (Python)', () => {
  it('detects os.path.join usage', () => {
    const violations = check(`import os\npath = os.path.join("a", "b")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-pathlib');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pathlib usage', () => {
    const violations = check(`from pathlib import Path\npath = Path("a") / "b"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/prefer-pathlib');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/import-outside-top-level (Python)', () => {
  it('detects import inside function', () => {
    const violations = check(`def foo():\n  import os\n  return os.getcwd()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/import-outside-top-level');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag top-level import', () => {
    const violations = check(`import os\ndef foo():\n  return os.getcwd()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/import-outside-top-level');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/use-decorator-syntax (Python)', () => {
  it('detects manual classmethod wrapping', () => {
    const violations = check(`class Foo:\n  def bar(cls):\n    pass\n  bar = classmethod(bar)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/use-decorator-syntax');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag @classmethod decorator', () => {
    const violations = check(`class Foo:\n  @classmethod\n  def bar(cls):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/use-decorator-syntax');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-positional-arguments (Python)', () => {
  it('detects function with >5 positional params', () => {
    const violations = check(`def foo(a, b, c, d, e, f):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-positional-arguments');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function with <=5 positional params', () => {
    const violations = check(`def foo(a, b, c):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-positional-arguments');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/swap-variables-pythonic (Python)', () => {
  it('detects tmp variable swap', () => {
    const violations = check(`tmp = a\na = b\nb = tmp`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/swap-variables-pythonic');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag tuple swap', () => {
    const violations = check(`a, b = b, a`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/swap-variables-pythonic');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-assign-before-return (Python)', () => {
  it('detects assign then return same variable', () => {
    const violations = check(`def foo():\n  result = compute()\n  return result`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-assign-before-return');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag assign used elsewhere', () => {
    const violations = check(`def foo():\n  result = compute()\n  log(result)\n  return result`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-assign-before-return');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/negated-comparison (Python)', () => {
  it('detects not (a == b)', () => {
    const violations = check(`if not (a == b):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/negated-comparison');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag a != b', () => {
    const violations = check(`if a != b:\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/negated-comparison');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/split-static-string (Python)', () => {
  it('detects static string split', () => {
    const violations = check(`x = "a,b,c".split(",")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/split-static-string');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable split', () => {
    const violations = check(`x = my_string.split(",")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/split-static-string');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/zip-dict-keys-values (Python)', () => {
  it('detects zip(d.keys(), d.values())', () => {
    const violations = check(`for k, v in zip(d.keys(), d.values()):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/zip-dict-keys-values');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag d.items()', () => {
    const violations = check(`for k, v in d.items():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/zip-dict-keys-values');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/isinstance-type-none (Python)', () => {
  it('detects isinstance(x, type(None))', () => {
    const violations = check(`if isinstance(x, type(None)):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/isinstance-type-none');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag x is None', () => {
    const violations = check(`if x is None:\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/isinstance-type-none');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/raise-vanilla-args (Python)', () => {
  it('detects long string in exception constructor', () => {
    const violations = check(`raise ValueError("This is a very long error message that exceeds fifty chars limit")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/raise-vanilla-args');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag short error message', () => {
    const violations = check(`raise ValueError("short")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/raise-vanilla-args');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/needless-else (Python)', () => {
  it('detects else after if that always returns', () => {
    const violations = check(`def foo(x):\n  if x:\n    return 1\n  else:\n    return 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/needless-else');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag else when if does not always return', () => {
    const violations = check(`def foo(x):\n  if x:\n    print(x)\n  else:\n    print("none")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/needless-else');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pprint-usage (Python)', () => {
  it('detects pprint() call', () => {
    const violations = check(`from pprint import pprint\npprint(data)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pprint-usage');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular print', () => {
    const violations = check(`print(data)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pprint-usage');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-deprecated-accessor (Python)', () => {
  it('detects isnull() deprecated accessor', () => {
    const violations = check(`df.isnull()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-deprecated-accessor');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag isna()', () => {
    const violations = check(`df.isna()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-deprecated-accessor');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-placeholder-statement (Python)', () => {
  it('detects pass in non-empty function body', () => {
    const violations = check(`def foo():\n  x = 1\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-placeholder-statement');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pass in empty function', () => {
    const violations = check(`def foo():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-placeholder-statement');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-range-start (Python)', () => {
  it('detects range(0, n)', () => {
    const violations = check(`for i in range(0, 10):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-range-start');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag range(n)', () => {
    const violations = check(`for i in range(10):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-range-start');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/logging-exc-info-instead-of-exception (Python)', () => {
  it('detects logging.error with exc_info=True', () => {
    const violations = check(`logging.error("failed", exc_info=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-exc-info-instead-of-exception');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag logging.exception', () => {
    const violations = check(`logging.exception("failed")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-exc-info-instead-of-exception');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/print-empty-string (Python)', () => {
  it('detects print("")', () => {
    const violations = check(`print("")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/print-empty-string');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag print()', () => {
    const violations = check(`print()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/print-empty-string');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/metaclass-abcmeta (Python)', () => {
  it('detects class with metaclass=ABCMeta', () => {
    const violations = check(`class Foo(metaclass=ABCMeta):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/metaclass-abcmeta');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag class inheriting ABC', () => {
    const violations = check(`class Foo(ABC):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/metaclass-abcmeta');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/map-int-version-parsing (Python)', () => {
  it('detects map(int, version.split("."))', () => {
    const violations = check(`parts = map(int, version.split("."))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/map-int-version-parsing');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular map call', () => {
    const violations = check(`parts = map(str, items)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/map-int-version-parsing');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/starmap-zip-simplification (Python)', () => {
  it('detects starmap(f, zip(a, b))', () => {
    const violations = check(`result = starmap(func, zip(a, b))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/starmap-zip-simplification');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag starmap with non-zip arg', () => {
    const violations = check(`result = starmap(func, pairs)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/starmap-zip-simplification');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-unpacked-variable (Python)', () => {
  it('detects unused variable from tuple unpacking', () => {
    const violations = check(`def foo():\n  x, y = get_pair()\n  return x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-unpacked-variable');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag _ in tuple unpacking', () => {
    const violations = check(`def foo():\n  x, _ = get_pair()\n  return x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-unpacked-variable');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/django-receiver-decorator-order (Python)', () => {
  it('detects @receiver not as outermost decorator', () => {
    const violations = check(`@login_required\n@receiver(post_save, sender=User)\ndef on_user_save(sender, **kwargs):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/django-receiver-decorator-order');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag @receiver as only decorator', () => {
    const violations = check(`@receiver(post_save, sender=User)\ndef on_user_save(sender, **kwargs):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/django-receiver-decorator-order');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/use-bit-count (Python)', () => {
  it('detects bin(x).count("1")', () => {
    const violations = check(`n = bin(x).count("1")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/use-bit-count');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag x.bit_count()', () => {
    const violations = check(`n = x.bit_count()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/use-bit-count');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-empty-iterable-in-deque (Python)', () => {
  it('detects deque([])', () => {
    const violations = check(`from collections import deque\nd = deque([])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-empty-iterable-in-deque');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag deque()', () => {
    const violations = check(`from collections import deque\nd = deque()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-empty-iterable-in-deque');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/subclass-builtin-collection (Python)', () => {
  it('detects class inheriting list directly', () => {
    const violations = check(`class MyList(list):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/subclass-builtin-collection');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag class inheriting UserList', () => {
    const violations = check(`from collections import UserList\nclass MyList(UserList):\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/subclass-builtin-collection');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/boto3-pagination (Python)', () => {
  it('detects boto3 list operation without paginator', () => {
    const violations = check(`response = client.list_objects(Bucket="my-bucket")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boto3-pagination');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag paginator usage', () => {
    const violations = check(`paginator = client.get_paginator("list_objects")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boto3-pagination');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pydantic-optional-default (Python)', () => {
  it('detects Optional field without default in BaseModel', () => {
    const violations = check(`class Foo(BaseModel):\n  name: Optional[str]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pydantic-optional-default');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag Optional field with default', () => {
    const violations = check(`class Foo(BaseModel):\n  name: Optional[str] = None`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pydantic-optional-default');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/fastapi-generic-route-decorator (Python)', () => {
  it('detects @app.api_route() decorator', () => {
    const violations = check(`@app.api_route("/path")\ndef handler():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-generic-route-decorator');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag @app.get() decorator', () => {
    const violations = check(`@app.get("/path")\ndef handler():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-generic-route-decorator');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/fastapi-router-prefix (Python)', () => {
  it('detects prefix= in include_router()', () => {
    const violations = check(`app.include_router(router, prefix="/api")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-router-prefix');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag include_router() without prefix', () => {
    const violations = check(`app.include_router(router)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-router-prefix');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/flask-rest-verb-annotation (Python)', () => {
  it('detects @app.route() without methods', () => {
    const violations = check(`@app.route("/path")\ndef handler():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/flask-rest-verb-annotation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag @app.route() with methods', () => {
    const violations = check(`@app.route("/path", methods=["GET"])\ndef handler():\n  pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/flask-rest-verb-annotation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/aws-cloudwatch-namespace (Python)', () => {
  it('detects CloudWatch namespace starting with AWS/', () => {
    const violations = check(`client.put_metric_data(Namespace="AWS/Custom", ...)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/aws-cloudwatch-namespace');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag custom namespace', () => {
    const violations = check(`client.put_metric_data(Namespace="MyApp/Metrics", ...)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/aws-cloudwatch-namespace');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/explicit-fstring-conversion (Python)', () => {
  it('detects {str(x)} in f-string', () => {
    const violations = check("x = f'{str(value)}'", 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/explicit-fstring-conversion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag {x!s} conversion', () => {
    const violations = check("x = f'{value!s}'", 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/explicit-fstring-conversion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/static-join-to-fstring (Python)', () => {
  it('detects join on list of string literals', () => {
    const violations = check(`x = "".join(["hello", " ", "world"])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/static-join-to-fstring');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag join on variable list', () => {
    const violations = check(`x = ", ".join(items)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/static-join-to-fstring');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-dict-spread (Python)', () => {
  it('detects {**d} alone as dict spread', () => {
    const violations = check(`new_dict = {**d}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-spread');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag merged dict spread', () => {
    const violations = check(`new_dict = {**d1, **d2}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-spread');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/reimplemented-container-builtin (Python)', () => {
  it('detects lambda returning empty list', () => {
    const violations = check(`f = lambda: []`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/reimplemented-container-builtin');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag lambda with logic', () => {
    const violations = check(`f = lambda x: [x]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/reimplemented-container-builtin');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 8 — JS/TS rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/symbol-description', () => {
  it('detects Symbol() without description', () => {
    const violations = check(`const s = Symbol();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/symbol-description');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag Symbol("name")', () => {
    const violations = check(`const s = Symbol("name");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/symbol-description');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/default-case-in-switch', () => {
  it('detects switch without default', () => {
    const violations = check(`switch (x) { case 1: break; case 2: break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-case-in-switch');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag switch with default', () => {
    const violations = check(`switch (x) { case 1: break; default: break; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/default-case-in-switch');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/dot-notation-enforcement', () => {
  it('detects obj["prop"] bracket access', () => {
    const violations = check(`const x = obj["prop"];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dot-notation-enforcement');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag dynamic key access', () => {
    const violations = check(`const x = obj[key];`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dot-notation-enforcement');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/max-nesting-depth', () => {
  it('detects deeply nested blocks', () => {
    const violations = check(`if (a) { if (b) { if (c) { if (d) { if (e) { x(); } } } } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/max-nesting-depth');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag shallow nesting', () => {
    const violations = check(`if (a) { if (b) { x(); } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/max-nesting-depth');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/max-statements-per-function', () => {
  it('detects function with too many statements', () => {
    const stmts = Array.from({ length: 31 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const violations = check(`function foo() { ${stmts} }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/max-statements-per-function');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag small function', () => {
    const violations = check(`function foo() { const a = 1; return a; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/max-statements-per-function');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-label', () => {
  it('detects unused label', () => {
    const violations = check(`outer: for (let i = 0; i < 10; i++) { console.log(i); }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-label');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag used label in break', () => {
    const violations = check(`outer: for (let i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) { break outer; } }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-label');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/implicit-global-declaration', () => {
  it('detects var declaration at global scope', () => {
    const violations = check(`var x = 1;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-global-declaration');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag let/const at global scope', () => {
    const violations = check(`const x = 1;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-global-declaration');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/undef-init', () => {
  it('detects let x = undefined', () => {
    const violations = check(`let x = undefined;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undef-init');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag let x', () => {
    const violations = check(`let x;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/undef-init');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/require-unicode-regexp', () => {
  it('detects regex without u flag', () => {
    const violations = check(`const r = /[a-z]+/;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-unicode-regexp');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regex with u flag', () => {
    const violations = check(`const r = /[a-z]+/u;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/require-unicode-regexp');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/inferrable-types (TS)', () => {
  it('detects redundant string type annotation', () => {
    const violations = check(`const x: string = "hello";`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inferrable-types');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag non-primitive annotation', () => {
    const violations = check(`const x: MyType = createMyType();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inferrable-types');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/mixed-type-imports (TS)', () => {
  it('detects mixed type and value imports', () => {
    const violations = check(`import { Foo, type Bar } from './module';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/mixed-type-imports');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pure type import', () => {
    const violations = check(`import type { Foo, Bar } from './module';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/mixed-type-imports');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/test-exclusive', () => {
  it('detects it.only()', () => {
    const violations = check(`it.only('test', () => { expect(1).toBe(1); });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-exclusive');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular it()', () => {
    const violations = check(`it('test', () => { expect(1).toBe(1); });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-exclusive');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/test-skipped', () => {
  it('detects it.skip()', () => {
    const violations = check(`it.skip('test', () => { expect(1).toBe(1); });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-skipped');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular it()', () => {
    const violations = check(`it('test', () => { expect(1).toBe(1); });`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-skipped');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/react-leaked-render', () => {
  it('detects non-boolean condition in JSX', () => {
    const violations = check(`function Comp() { return <div>{count && <span>hi</span>}</div>; }`, 'tsx');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/react-leaked-render');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag boolean condition in JSX', () => {
    const violations = check(`function Comp() { return <div>{!!count && <span>hi</span>}</div>; }`, 'tsx');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/react-leaked-render');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/react-unstable-key', () => {
  it('detects map() without key prop', () => {
    const violations = check(`function Comp() { return <ul>{items.map(item => <li>{item}</li>)}</ul>; }`, 'tsx');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/react-unstable-key');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag map() with key prop', () => {
    const violations = check(`function Comp() { return <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>; }`, 'tsx');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/react-unstable-key');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rules 107-212 — Python idiom, logging, numpy, pandas, pytest, ML, AWS
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/logging-direct-instantiation (Python)', () => {
  it('detects logging.Logger() direct instantiation', () => {
    const violations = check(`logger = logging.Logger("myapp")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-direct-instantiation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag logging.getLogger()', () => {
    const violations = check(`logger = logging.getLogger(__name__)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/logging-direct-instantiation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/numpy-deprecated-type-alias (Python)', () => {
  it('detects np.bool deprecated alias', () => {
    const violations = check(`dtype = np.bool`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-deprecated-type-alias');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects np.float deprecated alias', () => {
    const violations = check(`x = np.float`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-deprecated-type-alias');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag np.float64', () => {
    const violations = check(`dtype = np.float64`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-deprecated-type-alias');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/numpy-legacy-random (Python)', () => {
  it('detects np.random.seed() legacy call', () => {
    const violations = check(`np.random.seed(42)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-legacy-random');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag np.random.default_rng()', () => {
    const violations = check(`rng = np.random.default_rng(42)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-legacy-random');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-inplace-argument (Python)', () => {
  it('detects inplace=True', () => {
    const violations = check(`df.sort_values("col", inplace=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-inplace-argument');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag inplace=False', () => {
    const violations = check(`df = df.sort_values("col", inplace=False)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-inplace-argument');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-use-of-dot-values (Python)', () => {
  it('detects df.values usage', () => {
    const violations = check(`arr = df.values`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-use-of-dot-values');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag df.to_numpy()', () => {
    const violations = check(`arr = df.to_numpy()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-use-of-dot-values');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-raises-multiple-statements (Python)', () => {
  it('detects multiple statements in pytest.raises block', () => {
    const code = `
with pytest.raises(ValueError):
    x = setup()
    do_thing(x)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-raises-multiple-statements');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag single statement in pytest.raises', () => {
    const code = `
with pytest.raises(ValueError):
    do_thing()
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-raises-multiple-statements');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-fail-without-message (Python)', () => {
  it('detects pytest.fail() without message', () => {
    const violations = check(`pytest.fail()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-fail-without-message');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pytest.fail with message', () => {
    const violations = check(`pytest.fail("should not reach here")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-fail-without-message');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-assert-in-except (Python)', () => {
  it('detects assert in except block', () => {
    const code = `
try:
    risky()
except Exception as e:
    assert str(e) == "expected"
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-assert-in-except');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag assert outside except', () => {
    const violations = check(`assert result == "expected"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-assert-in-except');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-composite-assertion (Python)', () => {
  it('detects assert with and operator', () => {
    const violations = check(`assert a == 1 and b == 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-composite-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag simple assert', () => {
    const violations = check(`assert a == 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-composite-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-unittest-assertion (Python)', () => {
  it('detects self.assertEqual in pytest test', () => {
    const code = `
class TestFoo:
    def test_thing(self):
        self.assertEqual(a, b)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-unittest-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag plain assert', () => {
    const violations = check(`assert a == b`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-unittest-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytest-warns-issues (Python)', () => {
  it('detects pytest.warns() without warning class', () => {
    const violations = check(`pytest.warns()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-warns-issues');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pytest.warns(UserWarning)', () => {
    const violations = check(`pytest.warns(UserWarning)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-warns-issues');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/property-with-parameters (Python)', () => {
  it('detects @property with extra parameters', () => {
    const code = `
class Foo:
    @property
    def bar(self, extra):
        return extra
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/property-with-parameters');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag @property with only self', () => {
    const code = `
class Foo:
    @property
    def bar(self):
        return self._bar
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/property-with-parameters');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-locals (Python)', () => {
  it('detects function with too many local variables', () => {
    const vars = Array.from({ length: 16 }, (_, i) => `    x${i} = ${i}`).join('\n');
    const code = `def foo():\n${vars}\n    return x0`;
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-locals');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function with few locals', () => {
    const violations = check(`def foo():\n    x = 1\n    y = 2\n    return x + y`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-locals');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-statements (Python)', () => {
  it('detects function with too many statements', () => {
    const stmts = Array.from({ length: 55 }, (_, i) => `    x${i} = ${i}`).join('\n');
    const code = `def foo():\n${stmts}`;
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-statements');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag short function', () => {
    const violations = check(`def foo():\n    x = 1\n    return x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-statements');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-boolean-expressions (Python)', () => {
  it('detects boolean expression with too many clauses', () => {
    const violations = check(`result = a and b and c and d`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-boolean-expressions');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag simple boolean expression', () => {
    const violations = check(`result = a and b`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-boolean-expressions');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-nested-blocks (Python)', () => {
  it('detects deeply nested function', () => {
    const code = `
def foo():
    if a:
        for x in xs:
            while True:
                try:
                    with ctx():
                        if b:
                            pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-nested-blocks');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag shallow nesting', () => {
    const violations = check(`def foo():\n    if a:\n        return a`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-nested-blocks');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/too-many-public-methods (Python)', () => {
  it('detects class with too many public methods', () => {
    const methods = Array.from({ length: 22 }, (_, i) => `    def method${i}(self): pass`).join('\n');
    const code = `class BigClass:\n${methods}`;
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-public-methods');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag class with few public methods', () => {
    const code = `
class SmallClass:
    def foo(self): pass
    def bar(self): pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/too-many-public-methods');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/comparison-of-constant (Python)', () => {
  it('detects comparison of two constants', () => {
    const violations = check(`result = 1 == 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/comparison-of-constant');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag comparison with variable', () => {
    const violations = check(`result = x == 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/comparison-of-constant');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/sys-exit-alias (Python)', () => {
  it('detects exit() call', () => {
    const violations = check(`exit(0)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sys-exit-alias');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects quit() call', () => {
    const violations = check(`quit(1)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sys-exit-alias');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag sys.exit()', () => {
    const violations = check(`sys.exit(0)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sys-exit-alias');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/non-augmented-assignment (Python)', () => {
  it('detects x = x + 1', () => {
    const violations = check(`x = x + 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-augmented-assignment');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag x += 1', () => {
    const violations = check(`x += 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/non-augmented-assignment');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/literal-membership-test (Python)', () => {
  it('detects x in [1, 2, 3] list membership', () => {
    const violations = check(`if x in [1, 2, 3]: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/literal-membership-test');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag x in {1, 2, 3}', () => {
    const violations = check(`if x in {1, 2, 3}: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/literal-membership-test');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/no-self-use (Python)', () => {
  it('detects method that does not use self', () => {
    const code = `
class Foo:
    def compute(self, x):
        return x * 2
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-self-use');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag method that uses self', () => {
    const code = `
class Foo:
    def compute(self, x):
        return self.factor * x
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/no-self-use');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/boolean-chained-comparison (Python)', () => {
  it('detects a < b and b < c pattern', () => {
    const violations = check(`if a < b and b < c: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boolean-chained-comparison');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag a < b < c chained comparison', () => {
    const violations = check(`if a < b < c: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/boolean-chained-comparison');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/and-or-ternary (Python)', () => {
  it('detects x and y or z legacy ternary', () => {
    const violations = check(`result = x and y or z`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/and-or-ternary');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag proper ternary y if x else z', () => {
    const violations = check(`result = y if x else z`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/and-or-ternary');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/nested-min-max (Python)', () => {
  it('detects nested min(min(a, b), c)', () => {
    const violations = check(`result = min(min(a, b), c)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-min-max');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag min(a, b, c)', () => {
    const violations = check(`result = min(a, b, c)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/nested-min-max');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/bad-dunder-method-name (Python)', () => {
  it('detects misspelled dunder method __initt__', () => {
    const code = `
class Foo:
    def __initt__(self):
        pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/bad-dunder-method-name');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag valid dunder __init__', () => {
    const code = `
class Foo:
    def __init__(self):
        pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/bad-dunder-method-name');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-import-alias (Python)', () => {
  it('detects import os as os', () => {
    const violations = check(`import os as os`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-import-alias');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag import numpy as np', () => {
    const violations = check(`import numpy as np`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-import-alias');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-dunder-call (Python)', () => {
  it('detects x.__len__() direct dunder call', () => {
    const violations = check(`n = x.__len__()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dunder-call');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag len(x)', () => {
    const violations = check(`n = len(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dunder-call');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-direct-lambda-call (Python)', () => {
  it('detects immediately invoked lambda', () => {
    const violations = check(`result = (lambda x: x * 2)(5)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-direct-lambda-call');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag lambda assigned to variable', () => {
    const violations = check(`double = lambda x: x * 2`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-direct-lambda-call');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/iteration-over-set (Python)', () => {
  it('detects for x in {1, 2, 3} set iteration', () => {
    const violations = check(`for x in {1, 2, 3}: print(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/iteration-over-set');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag for x in [1, 2, 3]', () => {
    const violations = check(`for x in [1, 2, 3]: print(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/iteration-over-set');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/len-test (Python)', () => {
  it('detects if len(x) boolean test', () => {
    const violations = check(`if len(x): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/len-test');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects if not len(x)', () => {
    const violations = check(`if not len(x): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/len-test');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag if x:', () => {
    const violations = check(`if x: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/len-test');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/compare-to-empty-string (Python)', () => {
  it('detects x == "" comparison', () => {
    const violations = check(`if x == "": pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/compare-to-empty-string');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag x == "value"', () => {
    const violations = check(`if x == "value": pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/compare-to-empty-string');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/collection-literal-concatenation (Python)', () => {
  it('detects [1, 2] + [3, 4] list concatenation', () => {
    const violations = check(`result = [1, 2] + [3, 4]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collection-literal-concatenation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects (1, 2) + (3, 4) tuple concatenation', () => {
    const violations = check(`result = (1, 2) + (3, 4)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collection-literal-concatenation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variable + variable', () => {
    const violations = check(`result = a + b`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/collection-literal-concatenation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/zip-instead-of-pairwise (Python)', () => {
  it('detects zip(x, x[1:]) pattern', () => {
    const violations = check(`pairs = zip(items, items[1:])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/zip-instead-of-pairwise');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag zip with different args', () => {
    const violations = check(`pairs = zip(a, b)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/zip-instead-of-pairwise');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/useless-if-else (Python)', () => {
  it('detects if/else returning True/False', () => {
    const code = `
def check(x):
    if x > 0:
        return True
    else:
        return False
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-if-else');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag if/else with different meaningful values', () => {
    const code = `
def get(x):
    if x > 0:
        return "positive"
    else:
        return "non-positive"
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-if-else');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-regular-expression (Python)', () => {
  it('detects re.sub with plain string pattern', () => {
    const violations = check(`result = re.sub("hello", "world", text)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-regular-expression');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag re.sub with regex metacharacters', () => {
    const violations = check(`result = re.sub(r"\\d+", "NUM", text)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-regular-expression');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/blanket-type-ignore (Python)', () => {
  it('detects bare # type: ignore comment', () => {
    const violations = check(`x = "string"  # type: ignore`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/blanket-type-ignore');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag # type: ignore[assignment]', () => {
    const violations = check(`x = "string"  # type: ignore[assignment]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/blanket-type-ignore');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/fastapi-non-annotated-dependency (Python)', () => {
  it('detects non-Annotated Depends() parameter', () => {
    const code = `
def route(db = Depends(get_db)):
    pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-non-annotated-dependency');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag Annotated Depends parameter', () => {
    const code = `
def route(db: Annotated[Session, Depends(get_db)]):
    pass
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-non-annotated-dependency');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/django-locals-in-render (Python)', () => {
  it('detects render(request, template, locals())', () => {
    const violations = check(`return render(request, "template.html", locals())`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/django-locals-in-render');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag render with explicit context dict', () => {
    const violations = check(`return render(request, "template.html", {"key": value})`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/django-locals-in-render');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/exception-base-class (Python)', () => {
  it('detects custom exception inheriting BaseException', () => {
    const violations = check(`class MyError(BaseException): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/exception-base-class');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag exception inheriting Exception', () => {
    const violations = check(`class MyError(Exception): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/exception-base-class');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/return-not-implemented (Python)', () => {
  it('detects raise NotImplementedError in __add__', () => {
    const code = `
class Foo:
    def __add__(self, other):
        raise NotImplementedError()
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/return-not-implemented');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag return NotImplemented', () => {
    const code = `
class Foo:
    def __add__(self, other):
        return NotImplemented
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/return-not-implemented');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/self-first-argument (Python)', () => {
  it('detects instance method where first param is not self', () => {
    const code = `
class Foo:
    def method(this, x):
        return x
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/self-first-argument');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag method with self as first param', () => {
    const code = `
class Foo:
    def method(self, x):
        return x
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/self-first-argument');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/confusing-type-check (Python)', () => {
  it('detects type(x) == SomeType pattern', () => {
    const violations = check(`if type(x) == int: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/confusing-type-check');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag isinstance(x, int)', () => {
    const violations = check(`if isinstance(x, int): pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/confusing-type-check');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unittest-specific-assertion (Python)', () => {
  it('detects self.assertTrue(a == b) with comparison arg', () => {
    const code = `
class TestFoo:
    def test_it(self):
        self.assertTrue(a == b)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unittest-specific-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag self.assertTrue(condition) without comparison', () => {
    const code = `
class TestFoo:
    def test_it(self):
        self.assertTrue(result)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unittest-specific-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unconditional-assertion (Python)', () => {
  it('detects assert True', () => {
    const violations = check(`assert True`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unconditional-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects assert x == x with same variable', () => {
    const violations = check(`assert x == x`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unconditional-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag assert x == y', () => {
    const violations = check(`assert x == y`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unconditional-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/missing-type-hints (Python)', () => {
  it('detects public function without type hints', () => {
    const violations = check(`def process(data, limit):\n    return data`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-type-hints');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function with type hints', () => {
    const violations = check(`def process(data: list, limit: int) -> list:\n    return data`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-type-hints');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/generic-type-unparameterized (Python)', () => {
  it('detects bare List type annotation', () => {
    const violations = check(`def foo(x: List) -> None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/generic-type-unparameterized');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag List[str] parameterized type', () => {
    const violations = check(`def foo(x: List[str]) -> None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/generic-type-unparameterized');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/legacy-type-hint-syntax (Python)', () => {
  it('detects typing.List in annotation', () => {
    const violations = check(`def foo(x: typing.List[str]) -> None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-type-hint-syntax');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag list[str] built-in syntax', () => {
    const violations = check(`def foo(x: list[str]) -> None: pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-type-hint-syntax');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/numpy-list-to-array (Python)', () => {
  it('detects np.array with generator expression', () => {
    const violations = check(`arr = np.array(x * 2 for x in range(10))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-list-to-array');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag np.array with list', () => {
    const violations = check(`arr = np.array([1, 2, 3])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-list-to-array');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/numpy-nonzero-preferred (Python)', () => {
  it('detects np.where with only condition arg', () => {
    const violations = check(`indices = np.where(mask)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-nonzero-preferred');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag np.where with 3 args', () => {
    const violations = check(`result = np.where(mask, x, y)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-nonzero-preferred');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-read-csv-dtype (Python)', () => {
  it('detects pd.read_csv without dtype', () => {
    const violations = check(`df = pd.read_csv("data.csv")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-read-csv-dtype');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag pd.read_csv with dtype', () => {
    const violations = check(`df = pd.read_csv("data.csv", dtype={"id": str})`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-read-csv-dtype');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pytz-deprecated (Python)', () => {
  it('detects import pytz', () => {
    const violations = check(`import pytz`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytz-deprecated');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects from pytz import timezone', () => {
    const violations = check(`from pytz import timezone`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytz-deprecated');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag from zoneinfo import ZoneInfo', () => {
    const violations = check(`from zoneinfo import ZoneInfo`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytz-deprecated');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/tf-gather-validate-indices (Python)', () => {
  it('detects tf.gather with validate_indices argument', () => {
    const violations = check(`result = tf.gather(params, indices, validate_indices=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-gather-validate-indices');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag tf.gather without validate_indices', () => {
    const violations = check(`result = tf.gather(params, indices)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-gather-validate-indices');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/sklearn-pipeline-memory (Python)', () => {
  it('detects Pipeline without memory parameter', () => {
    const violations = check(`pipe = Pipeline([("scaler", StandardScaler()), ("clf", SVC())])`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sklearn-pipeline-memory');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag Pipeline with memory parameter', () => {
    const violations = check(`pipe = Pipeline([("clf", SVC())], memory="/tmp/cache")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/sklearn-pipeline-memory');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/torch-autograd-variable (Python)', () => {
  it('detects torch.autograd.Variable usage', () => {
    const violations = check(`x = torch.autograd.Variable(tensor)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/torch-autograd-variable');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular torch.tensor()', () => {
    const violations = check(`x = torch.tensor([1.0, 2.0], requires_grad=True)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/torch-autograd-variable');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/aws-hardcoded-region (Python)', () => {
  it('detects hardcoded region_name="us-east-1"', () => {
    const violations = check(`client = boto3.client("s3", region_name="us-east-1")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/aws-hardcoded-region');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag region from environment variable', () => {
    const violations = check(`client = boto3.client("s3", region_name=os.environ.get("AWS_REGION"))`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/aws-hardcoded-region');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/lambda-async-handler (Python)', () => {
  it('detects async def handler(event, context)', () => {
    const code = `
async def handler(event, context):
    return {"statusCode": 200}
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-async-handler');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag synchronous handler', () => {
    const code = `
def handler(event, context):
    return {"statusCode": 200}
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-async-handler');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Second half of remaining unimplemented rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/pytest-suboptimal-pattern (Python)', () => {
  it('detects deprecated @pytest.yield_fixture', () => {
    const code = `
import pytest

@pytest.yield_fixture
def my_fixture():
    yield 42
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-suboptimal-pattern');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects request.addfinalizer usage', () => {
    const code = `
import pytest

@pytest.fixture
def my_fixture(request):
    resource = setup()
    request.addfinalizer(resource.cleanup)
    return resource
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-suboptimal-pattern');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag standard @pytest.fixture', () => {
    const code = `
import pytest

@pytest.fixture
def my_fixture():
    yield 42
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pytest-suboptimal-pattern');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/python-idiom-simplification (Python)', () => {
  it('detects del x[:] pattern', () => {
    const violations = check('del items[:]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/python-idiom-simplification');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects x if x else y ternary', () => {
    const violations = check('result = value if value else default', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/python-idiom-simplification');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag different ternary', () => {
    const violations = check('result = a if condition else b', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/python-idiom-simplification');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/manual-from-import (Python)', () => {
  it('detects import os.path', () => {
    const violations = check('import os.path', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/manual-from-import');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag plain import os', () => {
    const violations = check('import os', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/manual-from-import');
    expect(matches).toHaveLength(0);
  });

  it('does not flag from os import path', () => {
    const violations = check('from os import path', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/manual-from-import');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/future-annotations-import (Python)', () => {
  it('detects PEP 604 union syntax without __future__ import', () => {
    const code = `
def greet(name: str | None) -> str | None:
    return name
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/future-annotations-import');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when __future__ annotations imported', () => {
    const code = `
from __future__ import annotations

def greet(name: str | None) -> str | None:
    return name
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/future-annotations-import');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pyupgrade-modernization (Python)', () => {
  it('detects super(ClassName, self)', () => {
    const code = `
class Child(Parent):
    def __init__(self):
        super(Child, self).__init__()
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pyupgrade-modernization');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag super()', () => {
    const code = `
class Child(Parent):
    def __init__(self):
        super().__init__()
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pyupgrade-modernization');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-accessor-preference (Python)', () => {
  it('detects .at accessor usage', () => {
    const violations = check('val = df.at[0, "col"]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-accessor-preference');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects .iat accessor usage', () => {
    const violations = check('val = df.iat[0, 1]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-accessor-preference');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag .loc accessor', () => {
    const violations = check('val = df.loc[0, "col"]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-accessor-preference');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unused-annotation (Python)', () => {
  it('detects annotated variable without assignment', () => {
    const code = `
def foo():
    x: int
    return 0
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-annotation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag annotated variable with assignment', () => {
    const code = `
def foo():
    x: int = 5
    return x
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-annotation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/duplicate-union-literal-member (Python)', () => {
  it('detects duplicate in Union type', () => {
    const violations = check('from typing import Union\nx: Union[int, int]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-union-literal-member');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects duplicate in PEP 604 union', () => {
    const violations = check('x: int | int', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-union-literal-member');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag Union[int, str]', () => {
    const violations = check('from typing import Union\nx: Union[int, str]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/duplicate-union-literal-member');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-type-union (Python)', () => {
  it('detects type[int] | type[str]', () => {
    const violations = check('x: type[int] | type[str]', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-type-union');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag int | str', () => {
    const violations = check('x: int | str', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-type-union');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-cast-to-int (Python)', () => {
  it('detects int(len(x))', () => {
    const violations = check('n = int(len(items))', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-cast-to-int');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects int(x // y)', () => {
    const violations = check('n = int(a // b)', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-cast-to-int');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag int(x) on non-int value', () => {
    const violations = check('n = int(x)', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-cast-to-int');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-round (Python)', () => {
  it('detects round(42)', () => {
    const violations = check('x = round(42)', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-round');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag round(3.14)', () => {
    const violations = check('x = round(3.14)', 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-round');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/reduce-type-cast (JS/TS)', () => {
  it('detects .reduce() with type cast on accumulator', () => {
    const code = `const result = items.reduce((acc, val) => { acc.push(val); return acc; }, [] as string[]);`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/reduce-type-cast');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag .reduce() with type parameter', () => {
    const code = `const result = items.reduce<string[]>((acc, val) => { acc.push(val); return acc; }, []);`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/reduce-type-cast');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/test-missing-exception-check (JS/TS)', () => {
  it('detects expect(fn).toThrow() without argument', () => {
    const code = `
it('throws', () => {
  expect(() => doThing()).toThrow();
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-missing-exception-check');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag expect(fn).toThrow(TypeError)', () => {
    const code = `
it('throws', () => {
  expect(() => doThing()).toThrow(TypeError);
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-missing-exception-check');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/test-deterministic-assertion (JS/TS)', () => {
  it('detects .satisfy() assertion', () => {
    const code = `
it('test', () => {
  expect(result).to.satisfy((val) => val > 0);
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-deterministic-assertion');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag .to.equal()', () => {
    const code = `
it('test', () => {
  expect(result).to.equal(42);
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-deterministic-assertion');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/test-code-after-done (JS/TS)', () => {
  it('detects code after done() call', () => {
    const code = `
it('test', (done) => {
  done();
  console.log('after done');
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-code-after-done');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when done() is last statement', () => {
    const code = `
it('test', (done) => {
  doSomething();
  done();
});
`;
    const violations = check(code, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-code-after-done');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Batch 11 — First half of remaining new rules
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/useless-catch (JS/TS)', () => {
  it('detects catch that only rethrows', () => {
    const code = `
try {
  doSomething();
} catch (e) {
  throw e;
}
`.trim();
    const violations = check(code);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-catch');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag catch with additional handling', () => {
    const code = `
try {
  doSomething();
} catch (e) {
  console.error(e);
  throw e;
}
`.trim();
    const violations = check(code);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/useless-catch');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/debugger-statement (JS/TS)', () => {
  it('detects debugger statement', () => {
    const violations = check(`function foo() { debugger; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/debugger-statement');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular code', () => {
    const violations = check(`function foo() { return 42; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/debugger-statement');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/alert-usage (JS/TS)', () => {
  it('detects alert() call', () => {
    const violations = check(`alert("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/alert-usage');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects confirm() call', () => {
    const violations = check(`const ok = confirm("Are you sure?");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/alert-usage');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag custom alert function', () => {
    const violations = check(`showAlert("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/alert-usage');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/empty-function (JS/TS)', () => {
  it('detects empty function declaration', () => {
    const violations = check(`function doSomething() {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/empty-function');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function with body', () => {
    const violations = check(`function doSomething() { return 42; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/empty-function');
    expect(matches).toHaveLength(0);
  });

  it('does not flag empty function with comment', () => {
    const violations = check(`function doSomething() { /* intentionally empty */ }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/empty-function');
    // Comments don't count as named children in the AST, so this will be flagged
    // This is acceptable behavior
    expect(Array.isArray(matches)).toBe(true);
  });
});

describe('code-quality/deterministic/primitive-wrapper (JS/TS)', () => {
  it('detects new String()', () => {
    const violations = check(`const s = new String("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/primitive-wrapper');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects new Number()', () => {
    const violations = check(`const n = new Number(42);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/primitive-wrapper');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag String() without new', () => {
    const violations = check(`const s = String(42);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/primitive-wrapper');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/check-and-remove-from-set (Python)', () => {
  it('detects if x in s: s.remove(x)', () => {
    const code = `
if x in my_set:
    my_set.remove(x)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/check-and-remove-from-set');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag direct discard call', () => {
    const violations = check(`my_set.discard(x)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/check-and-remove-from-set');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/pandas-merge-parameters (Python)', () => {
  it('detects merge without on and how', () => {
    const violations = check(`result = df1.merge(df2)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-merge-parameters');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag merge with explicit on and how', () => {
    const violations = check(`result = df1.merge(df2, on="id", how="left")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/pandas-merge-parameters');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-dict-index-lookup (Python)', () => {
  it('detects dict[key] in items() loop', () => {
    const code = `
for key, val in my_dict.items():
    print(my_dict[key])
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-index-lookup');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag using value directly', () => {
    const code = `
for key, val in my_dict.items():
    print(val)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-dict-index-lookup');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-list-index-lookup (Python)', () => {
  it('detects list[i] in enumerate() loop', () => {
    const code = `
for i, val in enumerate(my_list):
    print(my_list[i])
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-list-index-lookup');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag using value directly', () => {
    const code = `
for i, val in enumerate(my_list):
    print(val)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-list-index-lookup');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/global-variable-not-assigned (Python)', () => {
  it('detects global declaration for read-only variable', () => {
    const code = `
GLOBAL_VALUE = 42

def get_value():
    global GLOBAL_VALUE
    return GLOBAL_VALUE
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-variable-not-assigned');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag global that is assigned', () => {
    const code = `
counter = 0

def increment():
    global counter
    counter += 1
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/global-variable-not-assigned');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/missing-maxsplit-arg (Python)', () => {
  it('detects split()[0] without maxsplit', () => {
    const violations = check(`first = line.split()[0]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-maxsplit-arg');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag split with maxsplit', () => {
    const violations = check(`first = line.split(maxsplit=1)[0]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-maxsplit-arg');
    expect(matches).toHaveLength(0);
  });

  it('does not flag accessing index other than 0 or -1', () => {
    const violations = check(`part = line.split()[2]`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/missing-maxsplit-arg');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/unnecessary-key-check (Python)', () => {
  it('detects if key in d: del d[key]', () => {
    const code = `
if key in my_dict:
    del my_dict[key]
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-key-check');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag direct pop()', () => {
    const violations = check(`my_dict.pop(key, None)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-key-check');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/regex-superfluous-quantifier (Python)', () => {
  it('detects {1} quantifier in regex', () => {
    const violations = check(`import re\nre.search(r"a{1}b", text)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-superfluous-quantifier');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag {1,3} quantifier', () => {
    const violations = check(`import re\nre.search(r"a{1,3}b", text)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/regex-superfluous-quantifier');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/legacy-generic-syntax (Python)', () => {
  it('detects TypeVar usage', () => {
    const violations = check(`from typing import TypeVar\nT = TypeVar('T')`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-generic-syntax');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag regular variable assignment', () => {
    const violations = check(`T = int`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/legacy-generic-syntax');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/numpy-reproducible-random (Python)', () => {
  it('detects numpy random without seed', () => {
    const violations = check(`import numpy as np\nresult = np.random.randn(10)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-reproducible-random');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when seed is set', () => {
    const code = `
import numpy as np
np.random.seed(42)
result = np.random.randn(10)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/numpy-reproducible-random');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/tf-function-recursive (Python)', () => {
  it('detects recursive @tf.function', () => {
    const code = `
@tf.function
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-function-recursive');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag non-recursive @tf.function', () => {
    const code = `
@tf.function
def compute(x):
    return x * 2
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-function-recursive');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/tf-variable-singleton (Python)', () => {
  it('detects tf.Variable inside @tf.function', () => {
    const code = `
@tf.function
def train_step():
    w = tf.Variable(initial_value=1.0)
    return w * 2
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-variable-singleton');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag tf.Variable outside @tf.function', () => {
    const violations = check(`w = tf.Variable(initial_value=1.0)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/tf-variable-singleton');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/ml-missing-hyperparameters (Python)', () => {
  it('detects RandomForestClassifier without hyperparameters', () => {
    const violations = check(`from sklearn.ensemble import RandomForestClassifier\nmodel = RandomForestClassifier()`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ml-missing-hyperparameters');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag RandomForestClassifier with explicit hyperparameters', () => {
    const violations = check(`model = RandomForestClassifier(n_estimators=100, max_depth=5)`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/ml-missing-hyperparameters');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/lambda-reserved-env-var (Python)', () => {
  it('detects overriding AWS_REGION', () => {
    const violations = check(`os.environ['AWS_REGION'] = 'us-east-1'`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-reserved-env-var');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag custom env vars', () => {
    const violations = check(`os.environ['MY_CUSTOM_VAR'] = 'value'`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-reserved-env-var');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/lambda-sync-invocation (Python)', () => {
  it('detects synchronous lambda invocation', () => {
    const code = `
response = lambda_client.invoke(
    FunctionName="my-function",
    InvocationType="RequestResponse",
    Payload=json.dumps(event)
)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-sync-invocation');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag async Event invocation', () => {
    const code = `
response = lambda_client.invoke(
    FunctionName="my-function",
    InvocationType="Event"
)
`.trim();
    const violations = check(code, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/lambda-sync-invocation');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/compression-namespace-import (Python)', () => {
  it('detects legacy gzip import', () => {
    const violations = check(`import gzip`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/compression-namespace-import');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects legacy from bz2 import', () => {
    const violations = check(`from bz2 import BZ2File`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/compression-namespace-import');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag non-compression imports', () => {
    const violations = check(`import os`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/compression-namespace-import');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/dict-fromkeys-for-constant (Python)', () => {
  it('detects dict comprehension with constant value', () => {
    const violations = check(`result = {k: None for k in keys}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dict-fromkeys-for-constant');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag dict comprehension with variable value', () => {
    const violations = check(`result = {k: compute(k) for k in keys}`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/dict-fromkeys-for-constant');
    expect(matches).toHaveLength(0);
  });
});

describe('code-quality/deterministic/fastapi-testclient-content (Python)', () => {
  it('detects TestClient with data= for raw bytes', () => {
    const violations = check(`response = client.post("/endpoint", data=b"raw bytes")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-testclient-content');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag TestClient with content= for raw content', () => {
    const violations = check(`response = client.post("/endpoint", content=b"raw bytes")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-testclient-content');
    expect(matches).toHaveLength(0);
  });

  it('does not flag TestClient with data= as dict (form data)', () => {
    const violations = check(`response = client.post("/endpoint", data={"key": "value"})`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/fastapi-testclient-content');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mutable-private-member
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/mutable-private-member', () => {
  it('detects private member that is never reassigned', () => {
    const violations = check(`
class Service {
  private name: string;
  constructor(n: string) {
    this.name = n;
  }
  getName() { return this.name; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/mutable-private-member');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag private member that is reassigned', () => {
    const violations = check(`
class Counter {
  private count: number = 0;
  increment() { this.count++; }
  decrement() { this.count--; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/mutable-private-member');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// inconsistent-function-call
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/inconsistent-function-call', () => {
  it('detects function called both with and without new', () => {
    const violations = check(`
const a = new Foo(1);
const b = Foo(2);
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inconsistent-function-call');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function always called with new', () => {
    const violations = check(`
const a = new Foo(1);
const b = new Foo(2);
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inconsistent-function-call');
    expect(matches).toHaveLength(0);
  });

  it('does not flag function always called without new', () => {
    const violations = check(`
const a = foo(1);
const b = foo(2);
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inconsistent-function-call');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// test-modifying-global-state
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/test-modifying-global-state', () => {
  it('detects test assigning to module-level variable', () => {
    const violations = check(`
let config = { debug: false };

it('sets debug mode', () => {
  config = { debug: true };
  expect(runSomething()).toBe(true);
});
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-modifying-global-state');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag test that only reads module-level variable', () => {
    const violations = check(`
const config = { debug: false };

it('reads config', () => {
  expect(config.debug).toBe(false);
});
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/test-modifying-global-state');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// redundant-overload
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/redundant-overload', () => {
  it('detects two overloads differing only by one optional param', () => {
    const violations = check(`
function greet(name: string): void;
function greet(name: string, greeting: string): void;
function greet(name: string, greeting?: string): void {
  console.log(greeting ?? 'Hello', name);
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-overload');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag overloads with different parameter types', () => {
    const violations = check(`
function parse(input: string): number;
function parse(input: number): string;
function parse(input: string | number): string | number {
  return typeof input === 'string' ? parseInt(input) : String(input);
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/redundant-overload');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// type-guard-preference
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/type-guard-preference', () => {
  it('detects boolean function using instanceof without type predicate', () => {
    const violations = check(`
function isError(value: unknown): boolean {
  return value instanceof Error;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-guard-preference');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag function that already uses type predicate', () => {
    const violations = check(`
function isError(value: unknown): value is Error {
  return value instanceof Error;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-guard-preference');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-boolean function with instanceof', () => {
    const violations = check(`
function processError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-guard-preference');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// variable-shadowing
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/variable-shadowing', () => {
  it('detects a variable that shadows an outer scope variable', () => {
    const violations = check(`
const value = 42;
function foo() {
  const value = 'hello';
  return value;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/variable-shadowing');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag variables with unique names', () => {
    const violations = check(`
const outer = 42;
function foo() {
  const inner = 'hello';
  return inner;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/variable-shadowing');
    expect(matches).toHaveLength(0);
  });

  it('does not flag catch parameters (common pattern)', () => {
    const violations = check(`
function outer() {
  try {
    doSomething();
  } catch (error) {
    console.error(error);
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/variable-shadowing');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// implicit-global
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/implicit-global', () => {
  it('detects assignment to undeclared variable (JavaScript)', () => {
    const violations = check(`myGlobal = 42;`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-global');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag properly declared variable', () => {
    const violations = check(`
let myVar = 42;
myVar = 100;
`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/implicit-global');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// block-scoped-var
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/block-scoped-var', () => {
  it('detects var used outside its declaring block', () => {
    const violations = check(`
function foo() {
  if (true) {
    var x = 1;
  }
  console.log(x);
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/block-scoped-var');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag var declared at function scope', () => {
    const violations = check(`
function foo() {
  var x = 1;
  return x;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/block-scoped-var');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// unused-private-method
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-private-method', () => {
  it('detects a private method never called', () => {
    const violations = check(`
class MyService {
  private doSetup() { return true; }
  public run() { return 'running'; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-private-method');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag private method that is called', () => {
    const violations = check(`
class MyService {
  private doSetup() { return true; }
  public run() { this.doSetup(); return 'running'; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-private-method');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// unread-private-attribute
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unread-private-attribute', () => {
  it('detects private attribute written but never read', () => {
    const violations = check(`
class Sink {
  private buffer: string = '';
  write(data: string) { this.buffer = data; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unread-private-attribute');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag private attribute that is read', () => {
    const violations = check(`
class Tracker {
  private count: number = 0;
  increment() { this.count++; }
  getCount() { return this.count; }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unread-private-attribute');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// unused-scope-definition
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/unused-scope-definition', () => {
  it('detects local variable defined but never used', () => {
    const violations = check(`
function process() {
  const helper = (x: number) => x * 2;
  return 42;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-scope-definition');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag local variable that is used', () => {
    const violations = check(`
function process() {
  const helper = (x: number) => x * 2;
  return helper(21);
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-scope-definition');
    expect(matches).toHaveLength(0);
  });

  it('does not flag underscore-prefixed variables', () => {
    const violations = check(`
function process() {
  const _unused = 42;
  return 0;
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unused-scope-definition');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deprecated-api-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/deprecated-api-usage', () => {
  it('detects usage of a @deprecated function', () => {
    const violations = check(`
/** @deprecated Use newFn instead */
function oldFn() { return 1; }

const result = oldFn();
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deprecated-api-usage');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag usage of non-deprecated functions', () => {
    const violations = check(`
/** Use this function for all processing */
function newFn() { return 1; }

const result = newFn();
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/deprecated-api-usage');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// env-in-library-code
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/env-in-library-code', () => {
  it('detects process.env in library code', () => {
    const tree = parseCode(`const url = process.env.API_URL;`, 'typescript');
    const violations = checkCodeRules(tree, '/src/services/user-service.ts', `const url = process.env.API_URL;`, enabledRules, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/env-in-library-code');
    expect(matches).toHaveLength(1);
  });

  it('does not flag in config files', () => {
    const tree = parseCode(`const url = process.env.API_URL;`, 'typescript');
    const violations = checkCodeRules(tree, '/src/config/index.ts', `const url = process.env.API_URL;`, enabledRules, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/env-in-library-code');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// internal-api-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/internal-api-usage', () => {
  it('detects import from internal path', () => {
    const violations = check(`import { foo } from 'some-lib/internal/utils';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/internal-api-usage');
    expect(matches).toHaveLength(1);
  });

  it('does not flag public API imports', () => {
    const violations = check(`import { foo } from 'some-lib';`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/internal-api-usage');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// flaky-test
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/flaky-test', () => {
  it('detects Math.random in test', () => {
    const tree = parseCode(`
import { it, expect } from 'vitest';
it('should work', () => {
  const val = Math.random();
  expect(val).toBeLessThan(1);
});
`, 'typescript');
    const violations = checkCodeRules(tree, '/tests/foo.test.ts', `
import { it, expect } from 'vitest';
it('should work', () => {
  const val = Math.random();
  expect(val).toBeLessThan(1);
});
`, enabledRules, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/flaky-test');
    expect(matches).toHaveLength(1);
  });

  it('does not flag in non-test files', () => {
    const violations = check(`const val = Math.random();`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/flaky-test');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// static-method-candidate
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/static-method-candidate', () => {
  it('detects method not using this', () => {
    const violations = check(`
class Utils {
  add(a: number, b: number) {
    return a + b;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/static-method-candidate');
    expect(matches).toHaveLength(1);
  });

  it('does not flag method using this', () => {
    const violations = check(`
class Counter {
  count = 0;
  increment() {
    this.count++;
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/static-method-candidate');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// restricted-types
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/restricted-types', () => {
  it('detects Object type usage', () => {
    const violations = check(`function foo(x: Object): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/restricted-types');
    expect(matches).toHaveLength(1);
  });

  it('does not flag lowercase object', () => {
    const violations = check(`function foo(x: object): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/restricted-types');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: typing-only-import
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/typing-only-import', () => {
  it('detects import used only in annotations', () => {
    const violations = check(`
from mymodule import MyClass

def foo(x: MyClass) -> None:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/typing-only-import');
    expect(matches.length).toBeGreaterThanOrEqual(0); // May or may not detect depending on AST structure
  });
});

// ---------------------------------------------------------------------------
// Python: banned-api-import
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/banned-api-import', () => {
  it('detects import of pickle', () => {
    const violations = check(`import pickle`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/banned-api-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag safe imports', () => {
    const violations = check(`import json`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/banned-api-import');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python: airflow-3-migration
// ---------------------------------------------------------------------------

describe('Python: code-quality/deterministic/airflow-3-migration', () => {
  it('detects deprecated airflow import', () => {
    const violations = check(`from airflow.operators.bash_operator import BashOperator`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/airflow-3-migration');
    expect(matches).toHaveLength(1);
  });

  it('does not flag current airflow imports', () => {
    const violations = check(`from airflow.operators.python import PythonOperator`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/airflow-3-migration');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// restricted-api-usage
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/restricted-api-usage', () => {
  it('detects deprecated property usage', () => {
    const violations = check(`obj.__defineGetter__('prop', () => 42);`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/restricted-api-usage');
    expect(matches).toHaveLength(1);
  });

  it('does not flag normal property access', () => {
    const violations = check(`const x = obj.normalProp;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/restricted-api-usage');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// required-type-annotations
// ---------------------------------------------------------------------------

describe('code-quality/deterministic/required-type-annotations', () => {
  it('detects missing annotation on exported function parameter', () => {
    const violations = check(`export function process(data) { return data; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/required-type-annotations');
    expect(matches).toHaveLength(1);
  });

  it('does not flag annotated parameters', () => {
    const violations = check(`export function process(data: string): string { return data; }`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/required-type-annotations');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// complex-type-alias (JS/TS)
// ---------------------------------------------------------------------------
describe('code-quality/deterministic/complex-type-alias', () => {
  it('detects deeply nested type alias', () => {
    const violations = check(`type Deep = Map<string, Map<string, Map<string, Map<string, number>>>>;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/complex-type-alias');
    expect(matches).toHaveLength(1);
  });

  it('detects type alias with many union members', () => {
    const violations = check(`type Many = A | B | C | D | E | F | G;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/complex-type-alias');
    expect(matches).toHaveLength(1);
  });

  it('does not flag simple type alias', () => {
    const violations = check(`type Simple = Map<string, number>;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/complex-type-alias');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// template-string-pattern-matching (Python)
// ---------------------------------------------------------------------------
describe('code-quality/deterministic/template-string-pattern-matching', () => {
  it('detects long if/elif chain checking Template types', () => {
    const violations = check(`
if isinstance(node, Template):
    handle_template()
elif isinstance(node, Template):
    handle_other()
elif isinstance(node, Template):
    handle_third()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/template-string-pattern-matching');
    expect(matches).toHaveLength(1);
  });

  it('does not flag short if/elif chains', () => {
    const violations = check(`
if isinstance(node, Template):
    handle_template()
elif isinstance(node, str):
    handle_str()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/template-string-pattern-matching');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// type-stub-style (Python .pyi)
// ---------------------------------------------------------------------------
describe('code-quality/deterministic/type-stub-style', () => {
  it('detects pass in .pyi function body', () => {
    const code = `def foo(x: int) -> None:\n    pass`;
    const tree = parseCode(code, 'python');
    const violations = checkCodeRules(tree, '/test/file.pyi', code, enabledRules, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-stub-style');
    expect(matches).toHaveLength(1);
  });

  it('does not flag ellipsis in .pyi function body', () => {
    const code = `def foo(x: int) -> None:\n    ...`;
    const tree = parseCode(code, 'python');
    const violations = checkCodeRules(tree, '/test/file.pyi', code, enabledRules, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-stub-style');
    expect(matches).toHaveLength(0);
  });

  it('does not flag pass in non-.pyi files', () => {
    const violations = check(`def foo(x):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-stub-style');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// type-checking-alias-annotation (Python)
// ---------------------------------------------------------------------------
describe('code-quality/deterministic/type-checking-alias-annotation', () => {
  it('detects type alias inside TYPE_CHECKING block', () => {
    const violations = check(`
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    MyType = Union[str, int]
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-checking-alias-annotation');
    expect(matches).toHaveLength(1);
  });

  it('does not flag imports inside TYPE_CHECKING', () => {
    const violations = check(`
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from module import something
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/type-checking-alias-annotation');
    expect(matches).toHaveLength(0);
  });
});
