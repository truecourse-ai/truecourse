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
// JS/TS: accessor-pairs
// ---------------------------------------------------------------------------

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
