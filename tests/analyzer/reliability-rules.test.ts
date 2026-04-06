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
// catch-rethrow-no-context
// ---------------------------------------------------------------------------

describe('reliability/deterministic/catch-rethrow-no-context', () => {
  const ruleKey = 'reliability/deterministic/catch-rethrow-no-context';

  it('detects catch that just rethrows', () => {
    const violations = check(`
try {
  doSomething();
} catch (e) {
  throw e;
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag catch that wraps error', () => {
    const violations = check(`
try {
  doSomething();
} catch (e) {
  throw new Error('Context', { cause: e });
}
`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
