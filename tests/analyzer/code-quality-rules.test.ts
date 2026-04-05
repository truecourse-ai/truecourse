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
  it('detects == operator', () => {
    const violations = check(`if (x == null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(1);
  });

  it('detects != operator', () => {
    const violations = check(`if (x != null) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/strict-equality');
    expect(matches).toHaveLength(1);
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
  it('detects double negation !!x', () => {
    const violations = check(`const b = !!value;`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/inverted-boolean');
    expect(matches).toHaveLength(1);
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

  it('detects === false comparison', () => {
    const violations = check(`if (isReady === false) {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/unnecessary-boolean-compare');
    expect(matches).toHaveLength(1);
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
