import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/code-rules-checker';
import { CODE_RULES } from '../../packages/analyzer/src/rules/code-rules';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = CODE_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language);
}

describe('code/empty-catch', () => {
  it('detects empty catch blocks', () => {
    const violations = check(`
      try { doSomething(); } catch (e) {}
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code/empty-catch');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('Empty catch block');
  });

  it('does not flag catch blocks with statements', () => {
    const violations = check(`
      try { doSomething(); } catch (e) { console.error(e); }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code/empty-catch');
    expect(matches).toHaveLength(0);
  });

  it('does not flag catch blocks with only comments as empty', () => {
    const violations = check(`
      try { doSomething(); } catch (e) { /* intentionally empty */ }
    `);
    const matches = violations.filter((v) => v.ruleKey === 'code/empty-catch');
    // Comments-only catch blocks are still flagged since there's no actual error handling
    expect(matches).toHaveLength(1);
  });
});

describe('code/console-log', () => {
  it('detects console.log', () => {
    const violations = check(`console.log("hello");`);
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('console.log call');
  });

  it('detects console.debug', () => {
    const violations = check(`console.debug("debug info");`);
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('console.debug call');
  });

  it('does not flag console.error', () => {
    const violations = check(`console.error("error");`);
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(0);
  });

  it('does not flag console.warn', () => {
    const violations = check(`console.warn("warning");`);
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(0);
  });
});

describe('code/hardcoded-secret', () => {
  it('detects AWS access key pattern', () => {
    const violations = check(`const key = "AKIAIOSFODNN7EXAMPLE";`);
    const matches = violations.filter((v) => v.ruleKey === 'code/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Stripe-like key pattern', () => {
    const violations = check(`const key = "sk_live_abcdefghijklmnop";`);
    const matches = violations.filter((v) => v.ruleKey === 'code/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects password variable assignment', () => {
    const violations = check(`const password = "supersecret123";`);
    const matches = violations.filter((v) => v.ruleKey === 'code/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag short strings', () => {
    const violations = check(`const x = "hello";`);
    const matches = violations.filter((v) => v.ruleKey === 'code/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal strings', () => {
    const violations = check(`const greeting = "Hello, World! Welcome to the app";`);
    const matches = violations.filter((v) => v.ruleKey === 'code/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });
});

describe('code/todo-fixme', () => {
  it('detects TODO comments', () => {
    const violations = check(`// TODO: fix this later`);
    const matches = violations.filter((v) => v.ruleKey === 'code/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('TODO comment');
  });

  it('detects FIXME comments', () => {
    const violations = check(`/* FIXME: broken logic */`);
    const matches = violations.filter((v) => v.ruleKey === 'code/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('FIXME comment');
  });

  it('detects HACK comments', () => {
    const violations = check(`// HACK: workaround for issue #123`);
    const matches = violations.filter((v) => v.ruleKey === 'code/todo-fixme');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('HACK comment');
  });

  it('does not flag regular comments', () => {
    const violations = check(`// This function handles user authentication`);
    const matches = violations.filter((v) => v.ruleKey === 'code/todo-fixme');
    expect(matches).toHaveLength(0);
  });
});

describe('code/no-explicit-any', () => {
  it('detects explicit any type annotations', () => {
    const violations = check(`function foo(x: any): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code/no-explicit-any');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag specific types', () => {
    const violations = check(`function foo(x: string): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code/no-explicit-any');
    expect(matches).toHaveLength(0);
  });

  it('does not flag unknown type', () => {
    const violations = check(`function foo(x: unknown): void {}`);
    const matches = violations.filter((v) => v.ruleKey === 'code/no-explicit-any');
    expect(matches).toHaveLength(0);
  });
});

describe('code/sql-injection', () => {
  it('detects template literal in query()', () => {
    const violations = check('db.query(`SELECT * FROM users WHERE id = ${userId}`);');
    const matches = violations.filter((v) => v.ruleKey === 'code/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('detects string concatenation in query()', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = " + userId);`);
    const matches = violations.filter((v) => v.ruleKey === 'code/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('does not flag parameterized queries', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = $1", [userId]);`);
    const matches = violations.filter((v) => v.ruleKey === 'code/sql-injection');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-query method calls', () => {
    const violations = check('const x = format(`hello ${name}`);');
    const matches = violations.filter((v) => v.ruleKey === 'code/sql-injection');
    expect(matches).toHaveLength(0);
  });
});

describe('checkCodeRules integration', () => {
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
    // Should only get magic-number false positives from array index or similar
    const significant = violations.filter(
      (v) => v.ruleKey !== 'code/magic-number',
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
    expect(ruleKeys.has('code/todo-fixme')).toBe(true);
    expect(ruleKeys.has('code/empty-catch')).toBe(true);
    expect(ruleKeys.has('code/console-log')).toBe(true);
    expect(ruleKeys.has('code/hardcoded-secret')).toBe(true);
  });

  it('respects disabled rules', () => {
    const rulesWithDisabled = CODE_RULES.map((r) =>
      r.key === 'code/console-log' ? { ...r, enabled: false } : r,
    );
    const tree = parseCode(`console.log("test");`, 'typescript');
    const violations = checkCodeRules(tree, '/test.ts', `console.log("test");`, rulesWithDisabled, 'typescript');
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python code rules
// ---------------------------------------------------------------------------

describe('Python: code/empty-catch', () => {
  it('detects except with only pass', () => {
    const violations = check(`
try:
    do_something()
except Exception:
    pass
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/empty-catch');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except with handler', () => {
    const violations = check(`
try:
    do_something()
except Exception as e:
    logger.error(e)
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/empty-catch');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code/console-log (print)', () => {
  it('detects print() calls', () => {
    const violations = check(`print("hello world")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('print() call');
  });

  it('does not flag non-print calls', () => {
    const violations = check(`logger.info("hello")`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/console-log');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code/todo-fixme', () => {
  it('detects TODO comments', () => {
    const violations = check(`# TODO: fix this later\nx = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/todo-fixme');
    expect(matches).toHaveLength(1);
  });
});

describe('Python: code/bare-except', () => {
  it('detects bare except clause', () => {
    const violations = check(`
try:
    do_something()
except:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/bare-except');
    expect(matches).toHaveLength(1);
  });

  it('does not flag except Exception', () => {
    const violations = check(`
try:
    do_something()
except Exception:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/bare-except');
    expect(matches).toHaveLength(0);
  });

  it('flags except BaseException', () => {
    const violations = check(`
try:
    do_something()
except BaseException:
    handle_error()
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/bare-except');
    expect(matches).toHaveLength(1);
  });
});

describe('Python: code/mutable-default-arg', () => {
  it('detects list default', () => {
    const violations = check(`def foo(items=[]):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/mutable-default-arg');
    expect(matches).toHaveLength(1);
  });

  it('detects dict default', () => {
    const violations = check(`def foo(data={}):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/mutable-default-arg');
    expect(matches).toHaveLength(1);
  });

  it('does not flag None default', () => {
    const violations = check(`def foo(items=None):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });

  it('does not flag immutable defaults', () => {
    const violations = check(`def foo(x=5, name="default", flag=True):\n    pass`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code/star-import', () => {
  it('detects from module import *', () => {
    const violations = check(`from os import *`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/star-import');
    expect(matches).toHaveLength(1);
  });

  it('does not flag named imports', () => {
    const violations = check(`from os import path, getcwd`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/star-import');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: code/global-statement', () => {
  it('detects global inside function', () => {
    const violations = check(`
x = 0
def increment():
    global x
    x += 1
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/global-statement');
    expect(matches).toHaveLength(1);
  });

  it('does not flag global at module level', () => {
    const violations = check(`global x\nx = 1`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'code/global-statement');
    expect(matches).toHaveLength(0);
  });
});

describe('JS: code/global-statement (var)', () => {
  it('detects var inside function', () => {
    const violations = check(`function foo() { var x = 1; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code/global-statement');
    expect(matches).toHaveLength(1);
  });

  it('does not flag let/const inside function', () => {
    const violations = check(`function foo() { let x = 1; const y = 2; }`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code/global-statement');
    expect(matches).toHaveLength(0);
  });
});

describe('Python: language isolation', () => {
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

  it('does not fire bare-except on JS code', () => {
    const violations = check(`try { x() } catch(e) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code/bare-except');
    expect(matches).toHaveLength(0);
  });

  it('does not fire mutable-default-arg on JS code', () => {
    const violations = check(`function foo(x = []) {}`, 'javascript');
    const matches = violations.filter((v) => v.ruleKey === 'code/mutable-default-arg');
    expect(matches).toHaveLength(0);
  });
});
