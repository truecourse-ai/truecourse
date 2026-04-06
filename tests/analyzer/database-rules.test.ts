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
// connection-not-released
// ---------------------------------------------------------------------------

describe('database/deterministic/connection-not-released', () => {
  it('detects connect() outside try block', () => {
    const violations = check(`
const client = await pool.connect();
await client.query("SELECT 1");
client.release();
`);
    const matches = violations.filter((v) => v.ruleKey === 'database/deterministic/connection-not-released');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag connect() inside try block', () => {
    const violations = check(`
async function getUser() {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
`);
    const matches = violations.filter((v) => v.ruleKey === 'database/deterministic/connection-not-released');
    expect(matches).toHaveLength(0);
  });

  it('Python: detects connect() without context manager', () => {
    const violations = check(`
conn = db.connect()
cursor = conn.cursor()
cursor.execute("SELECT 1")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'database/deterministic/connection-not-released');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('Python: does not flag connect() inside with statement', () => {
    const violations = check(`
with db.connect() as conn:
    cursor = conn.cursor()
    cursor.execute("SELECT 1")
`, 'python');
    const matches = violations.filter((v) => v.ruleKey === 'database/deterministic/connection-not-released');
    expect(matches).toHaveLength(0);
  });
});
