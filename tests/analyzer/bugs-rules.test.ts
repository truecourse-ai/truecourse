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
});
