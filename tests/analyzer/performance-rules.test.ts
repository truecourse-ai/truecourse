import { describe, it, expect } from 'vitest';
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { parseCode } from '../../packages/analyzer/src/parser';

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled);

function check(code: string, language: 'typescript' | 'tsx' | 'javascript' | 'python' = 'typescript') {
  const extMap: Record<string, string> = { python: '.py', tsx: '.tsx', javascript: '.js' };
  const ext = extMap[language] ?? '.ts';
  const tree = parseCode(code, language);
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language);
}

function only(violations: ReturnType<typeof check>, ruleKey: string) {
  return violations.filter((v) => v.ruleKey === ruleKey);
}

// ---------------------------------------------------------------------------
// event-listener-no-remove
// ---------------------------------------------------------------------------

describe('performance/deterministic/event-listener-no-remove', () => {
  const KEY = 'performance/deterministic/event-listener-no-remove';

  it('detects addEventListener without removeEventListener', () => {
    const code = `
function setup() {
  window.addEventListener('click', handler);
}`;
    const violations = only(check(code), KEY);
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when removeEventListener is present', () => {
    const code = `
function setup() {
  window.addEventListener('click', handler);
  return () => window.removeEventListener('click', handler);
}`;
    const violations = only(check(code), KEY);
    expect(violations).toHaveLength(0);
  });
});
