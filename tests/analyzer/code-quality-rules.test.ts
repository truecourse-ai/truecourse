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
    const significant = violations.filter(
      (v) => v.ruleKey !== 'code-quality/llm/magic-number'
        && !v.ruleKey.startsWith('reliability/'),
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
