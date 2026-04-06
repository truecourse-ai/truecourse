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
// JS/TS: angular-sanitization-bypass
// ---------------------------------------------------------------------------

describe('security/deterministic/angular-sanitization-bypass', () => {
  const ruleKey = 'security/deterministic/angular-sanitization-bypass';

  it('detects bypassSecurityTrustHtml()', () => {
    const violations = check(`this.sanitizer.bypassSecurityTrustHtml(userInput);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('detects bypassSecurityTrustUrl()', () => {
    const violations = check(`this.sanitizer.bypassSecurityTrustUrl(url);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(1);
  });

  it('does not flag sanitize() calls', () => {
    const violations = check(`this.sanitizer.sanitize(SecurityContext.HTML, input);`);
    expect(violations.filter((v) => v.ruleKey === ruleKey)).toHaveLength(0);
  });
});
