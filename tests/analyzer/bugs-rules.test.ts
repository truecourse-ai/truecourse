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
