/**
 * Universal (language-agnostic) visitors audited against the C# grammar —
 * C# string/comment/call node types differ from JS/Python, so each universal
 * rule is exercised on real C# shapes here.
 */
import { describe, it, expect } from 'vitest'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string) {
  const tree = parseCode(code, 'csharp')
  return checkCodeRules(tree, '/test/File.cs', code, enabledRules, 'csharp')
}

describe('security/deterministic/hardcoded-secret (C#)', () => {
  it('detects a hardcoded secret in a string literal', () => {
    const violations = check(`namespace App;
public class StripeGateway
{
    private const string ApiKey = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a secret in a verbatim string', () => {
    const violations = check(`namespace App;
public class Db
{
    private const string Conn = @"Server=db;Database=app;User Id=sa;Password=Sup3rS3cretPwd!";
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret' || v.ruleKey === 'security/deterministic/hardcoded-database-password')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('detects a secret pasted in a comment', () => {
    const violations = check(`namespace App;
public class Auth
{
    // api_key = "AKIAIOSFODNN7EXAMPLE"
    public void Login() { }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag ordinary strings', () => {
    const violations = check(`namespace App;
public class Greeter
{
    public string Hello(string name) { return $"Hello, {name}! Welcome back."; }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret')
    expect(matches).toHaveLength(0)
  })
})

// hardcoded-ip is JS/Python-only; C# hardcoded IPs are detected by the more
// precise Roslyn-host rule hardcoded-ip-address (see roslyn-rules-security and
// the C# fixtures) — no tree-sitter coverage here.

describe('security/deterministic/clear-text-protocol (C#)', () => {
  it('detects an http:// connection target', () => {
    const violations = check(`namespace App;
public class Billing
{
    private const string Endpoint = "http://payments.internal.example.com/charge";
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/clear-text-protocol')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('does not flag protocol-inspection calls or interpolated hosts', () => {
    const violations = check(`namespace App;
public class UrlGuard
{
    public bool IsInsecure(string url) { return url.StartsWith("http://"); }
    public string Template(string host) { return $"http://{host}/probe"; }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'security/deterministic/clear-text-protocol')
    expect(matches).toHaveLength(0)
  })
})

describe('code-quality/deterministic/todo-fixme (C#)', () => {
  it('detects TODO comments including /// doc comments', () => {
    const violations = check(`namespace App;
public class Importer
{
    /// TODO: stream instead of buffering the whole file
    public void Import(string path) { }
}
`)
    const matches = violations.filter((v) => v.ruleKey === 'code-quality/deterministic/todo-fixme')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})
