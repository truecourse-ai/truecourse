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
