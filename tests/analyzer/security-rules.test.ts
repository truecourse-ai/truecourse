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

describe('security/deterministic/hardcoded-secret', () => {
  it('detects AWS access key pattern', () => {
    const violations = check(`const key = "AKIAIOSFODNN7EXAMPLE";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects Stripe-like key pattern', () => {
    const violations = check(`const key = "sk_live_abcdefghijklmnop";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('detects password variable assignment', () => {
    const violations = check(`const password = "supersecret123";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag short strings', () => {
    const violations = check(`const x = "hello";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag normal strings', () => {
    const violations = check(`const greeting = "Hello, World! Welcome to the app";`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag variable names containing uri/url/endpoint', () => {
    const violations = check(`token_uri = "https://oauth2.googleapis.com/token"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });

  it('does not flag Bearer as a secret value', () => {
    const violations = check(`token_type = "Bearer"`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });
});

describe('security/deterministic/sql-injection', () => {
  it('detects template literal in query()', () => {
    const violations = check('db.query(`SELECT * FROM users WHERE id = ${userId}`);');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('detects string concatenation in query()', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = " + userId);`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(1);
  });

  it('does not flag parameterized queries', () => {
    const violations = check(`db.query("SELECT * FROM users WHERE id = $1", [userId]);`);
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(0);
  });

  it('does not flag non-query method calls', () => {
    const violations = check('const x = format(`hello ${name}`);');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/sql-injection');
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

describe('Python: security/deterministic/hardcoded-secret', () => {
  it('does not flag dict keys with secret-like names', () => {
    const violations = check(`
config = {
    "token_uri": token_uri,
    "client_secret": client_secret,
    "access_token": creds.token,
}
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret');
    expect(matches).toHaveLength(0);
  });
});
