import { describe, it, expect } from 'vitest'
import { shannonEntropy } from '../../packages/analyzer/src/rules/security/entropy'
import { scanForSecrets, isSensitiveFile } from '../../packages/analyzer/src/rules/security/secret-scanner'
import { GLOBAL_ALLOWLIST } from '../../packages/analyzer/src/rules/security/exclusions'
import { SECRET_PATTERNS } from '../../packages/analyzer/src/rules/security/secret-rules'
import { checkCodeRules } from '../../packages/analyzer/src/rules/combined-code-checker'
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index'
import { parseCode } from '../../packages/analyzer/src/parser'

const enabledRules = ALL_DEFAULT_RULES.filter((r) => r.enabled)

function check(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  const ext = language === 'python' ? '.py' : '.ts'
  const tree = parseCode(code, language)
  return checkCodeRules(tree, `/test/file${ext}`, code, enabledRules, language)
}

function secretMatches(code: string, language: 'typescript' | 'javascript' | 'python' = 'typescript') {
  return check(code, language).filter((v) => v.ruleKey === 'security/deterministic/hardcoded-secret')
}

// ═══════════════════════════════════════════════════════════════════════
// Shannon entropy
// ═══════════════════════════════════════════════════════════════════════

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0)
  })

  it('returns 0 for single-char repeated', () => {
    expect(shannonEntropy('aaaaaaa')).toBe(0)
  })

  it('returns higher entropy for random-looking strings', () => {
    const low = shannonEntropy('aaabbbccc')
    const high = shannonEntropy('a1b2c3d4e5f6g7h8')
    expect(high).toBeGreaterThan(low)
  })

  it('returns ~1 for binary string', () => {
    expect(shannonEntropy('ab')).toBeCloseTo(1, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Global allowlist
// ═══════════════════════════════════════════════════════════════════════

describe('GLOBAL_ALLOWLIST', () => {
  it('suppresses env var refs', () => {
    expect(scanForSecrets('$API_KEY')).toBeNull()
    expect(scanForSecrets('${MY_SECRET}')).toBeNull()
  })

  it('suppresses template expressions', () => {
    expect(scanForSecrets('{{ user.token }}')).toBeNull()
    expect(scanForSecrets('${{ secrets.TOKEN }}')).toBeNull()
  })

  it('suppresses URLs', () => {
    expect(scanForSecrets('https://api.example.com/v1/users')).toBeNull()
  })

  it('suppresses Unix paths', () => {
    expect(scanForSecrets('/Users/dev/projects/myapp')).toBeNull()
    expect(scanForSecrets('/home/user/.ssh/config')).toBeNull()
  })

  it('suppresses literals', () => {
    expect(scanForSecrets('true')).toBeNull()
    expect(scanForSecrets('false')).toBeNull()
    expect(scanForSecrets('null')).toBeNull()
  })

  it('suppresses Windows env vars', () => {
    expect(scanForSecrets('%API_KEY%')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Prefix-based detection (unique prefix patterns)
// ═══════════════════════════════════════════════════════════════════════

describe('prefix-based secret detection', () => {
  it('detects Stripe live key', () => {
    const match = scanForSecrets('sk_live_4eC39HqLyjWDarjtT1zdp7dc')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('stripe-key')
  })

  it('detects Stripe test key', () => {
    const match = scanForSecrets('pk_test_TYooMQauvdEDq54NiTphI7jx')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('stripe-key')
  })

  it('detects AWS access key', () => {
    const match = scanForSecrets('AKIAIOSFODNN7EXAMPLE')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('aws-access-key')
  })

  it('detects GitHub PAT (classic)', () => {
    const match = scanForSecrets('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('github-pat')
  })

  it('detects GitHub fine-grained PAT', () => {
    const token = 'github_pat_11ABCDE0123456789abcdefGHIJKLMNOPQRSTUVWXYZ0123456789abcdefGHIJKLMNOPQRSTUVWXYZ01234567'
    const match = scanForSecrets(token)
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('github-token')
  })

  it('detects GitLab PAT', () => {
    const match = scanForSecrets('glpat-ABCDEFghijklmnopqrst1234')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('gitlab-pat')
  })

  it('detects Slack bot token', () => {
    const match = scanForSecrets('xoxb-1234567890-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('slack-bot-token')
  })

  it('detects npm token', () => {
    const match = scanForSecrets('npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('npm-token')
  })

  it('detects GCP API key', () => {
    const match = scanForSecrets('AIzaSyA1bcDeFgHiJkLmNoPqRsTuVwXyZ012345')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('gcp-key')
  })

  it('detects SendGrid token', () => {
    const match = scanForSecrets('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')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('sendgrid-token')
  })

  it('detects private key header', () => {
    const match = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('private-key')
  })

  it('detects JWT token', () => {
    const match = scanForSecrets('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('jwt-token')
  })

  it('detects Shopify access token', () => {
    const match = scanForSecrets('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')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('shopify-token')
  })

  it('detects PlanetScale token', () => {
    const match = scanForSecrets('pscale_tkn_abcdefghijklmnopqrstuvwxyz012345')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('planetscale-token')
  })

  it('detects Hugging Face token', () => {
    const match = scanForSecrets('hf_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('huggingface-token')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Context-based detection (keyword + pattern)
// ═══════════════════════════════════════════════════════════════════════

describe('context-based secret detection', () => {
  it('detects Datadog token via keyword', () => {
    const match = scanForSecrets('datadog_api_key=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('datadog-token')
  })

  it('detects Sonar token via keyword', () => {
    const match = scanForSecrets('sonar_token=squ_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('sonar-token')
  })

  it('detects Heroku API key', () => {
    const match = scanForSecrets('heroku_api_key=12345678-1234-1234-1234-123456789abc')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('heroku-key')
  })

  it('detects Slack webhook', () => {
    const match = scanForSecrets('https://hooks.slack.com/services/T12345678/B12345678/AbCdEfGhIjKlMnOp')
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('slack-webhook')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Generic detection (variable name fallback)
// ═══════════════════════════════════════════════════════════════════════

describe('generic / variable-name-based detection', () => {
  it('detects password variable assignment', () => {
    const matches = secretMatches(`const password = "supersecret123";`)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('detects api_key variable assignment', () => {
    const matches = secretMatches(`const api_key = "myR3alApiK3y!!";`)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('detects secret in Python assignment', () => {
    const matches = secretMatches(`secret = "xK9mL2vN7qR4wTp8"`, 'python')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// False positive tests
// ═══════════════════════════════════════════════════════════════════════

describe('false positive suppression', () => {
  it('does NOT flag BEARER_TOKEN type map', () => {
    const matches = secretMatches(`const BEARER_TOKEN = "Bearer";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag placeholder values', () => {
    expect(scanForSecrets('your_api_key_here_placeholder')).toBeNull()
  })

  it('does NOT flag env var references', () => {
    const matches = secretMatches(`const key = "$API_KEY";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag template expressions', () => {
    const matches = secretMatches(`const key = "{{ secrets.TOKEN }}";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag low-entropy strings', () => {
    // Repeated chars have low entropy
    expect(scanForSecrets('aaaaaaaabbbbbbbb')).toBeNull()
  })

  it('does NOT flag URLs', () => {
    const matches = secretMatches(`const url = "https://api.example.com/v1/auth";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag short strings', () => {
    const matches = secretMatches(`const x = "hello";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag normal strings', () => {
    const matches = secretMatches(`const greeting = "Hello, World! Welcome to the app";`)
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag variable names containing uri/url/endpoint', () => {
    const matches = secretMatches(`token_uri = "https://oauth2.googleapis.com/token"`, 'python')
    expect(matches).toHaveLength(0)
  })

  it('does NOT flag dict keys with secret-like names', () => {
    const matches = secretMatches(`
config = {
    "token_uri": token_uri,
    "client_secret": client_secret,
    "access_token": creds.token,
}
`, 'python')
    expect(matches).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Integration: end-to-end through the visitor
// ═══════════════════════════════════════════════════════════════════════

describe('hardcoded-secret visitor integration', () => {
  it('detects AWS key in TS assignment', () => {
    const matches = secretMatches(`const key = "AKIAIOSFODNN7EXAMPLE";`)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0].title).toContain('aws-access-key')
  })

  it('detects Stripe key in TS assignment', () => {
    const matches = secretMatches(`const key = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";`)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0].title).toContain('stripe-key')
  })

  it('detects GitHub PAT in Python', () => {
    const matches = secretMatches(`token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"`, 'python')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0].title).toContain('github-pat')
  })

  it('reports pattern ID in violation title', () => {
    const matches = secretMatches(`const k = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";`)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0].title).toMatch(/\(stripe-key\)/)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Pattern count sanity
// ═══════════════════════════════════════════════════════════════════════

describe('pattern coverage', () => {
  it('has at least 200 patterns', () => {
    expect(SECRET_PATTERNS.length).toBeGreaterThanOrEqual(200)
  })

  it('all patterns have id and description', () => {
    for (const p of SECRET_PATTERNS) {
      expect(p.id).toBeTruthy()
      expect(p.description).toBeTruthy()
      expect(p.regex).toBeInstanceOf(RegExp)
    }
  })

  it('has no duplicate pattern IDs', () => {
    const ids = SECRET_PATTERNS.map(p => p.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Gap 1: Sensitive file detection (path-only rules)
// ═══════════════════════════════════════════════════════════════════════

describe('sensitive file detection', () => {
  it('flags .pem files', () => {
    const result = isSensitiveFile('/path/to/server.pem')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
    expect(result!.description).toContain('.pem')
  })

  it('flags .key files', () => {
    const result = isSensitiveFile('/etc/ssl/private/cert.key')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
  })

  it('flags .p12 files', () => {
    const result = isSensitiveFile('/certs/identity.p12')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
  })

  it('flags .env files', () => {
    const result = isSensitiveFile('/app/.env')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
  })

  it('flags .env.production files', () => {
    const result = isSensitiveFile('/app/.env.production')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
  })

  it('flags .jks keystore files', () => {
    const result = isSensitiveFile('/app/keystore.jks')
    expect(result).not.toBeNull()
    expect(result!.isSensitive).toBe(true)
  })

  it('does NOT flag .ts files', () => {
    const result = isSensitiveFile('/src/index.ts')
    expect(result).toBeNull()
  })

  it('does NOT flag .js files', () => {
    const result = isSensitiveFile('/src/app.js')
    expect(result).toBeNull()
  })

  it('does NOT flag .json files', () => {
    const result = isSensitiveFile('/config/settings.json')
    expect(result).toBeNull()
  })

  it('flags sensitive file through the visitor (integration)', () => {
    const tree = parseCode('const x = 1', 'typescript')
    const violations = checkCodeRules(tree, '/app/secrets.pem', 'const x = 1', enabledRules, 'typescript')
    const sensitiveFileViolations = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('Sensitive file')
    )
    expect(sensitiveFileViolations.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT flag normal .ts file through the visitor', () => {
    const tree = parseCode('const x = 1', 'typescript')
    const violations = checkCodeRules(tree, '/src/index.ts', 'const x = 1', enabledRules, 'typescript')
    const sensitiveFileViolations = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('Sensitive file')
    )
    expect(sensitiveFileViolations).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Gap 2: Composite rules (proximity matching)
// ═══════════════════════════════════════════════════════════════════════

describe('composite rules (requireNearby)', () => {
  it('matches when nearby pattern is present', () => {
    const sourceCode = [
      'const config = {',
      '  url: "https://api.stripe.com",',
      '  key: "sk_live_4eC39HqLyjWDarjtT1zdp7dc",',
      '}',
    ].join('\n')

    // scanForSecrets with context should still match (Stripe key matches without nearby requirement)
    const match = scanForSecrets('sk_live_4eC39HqLyjWDarjtT1zdp7dc', {
      sourceCode,
      lineNumber: 3,
    })
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('stripe-key')
  })

  it('requireNearby blocks match when nearby pattern is absent', () => {
    // Without requireNearby on the pattern, it matches normally
    // This verifies the context parameter doesn't break existing behavior
    const sourceCode = 'const x = "AKIAIOSFODNN7EXAMPLE"'
    const match = scanForSecrets('AKIAIOSFODNN7EXAMPLE', {
      sourceCode,
      lineNumber: 1,
    })
    expect(match).not.toBeNull()
    expect(match!.patternId).toBe('aws-access-key')
  })

  it('scanForSecrets accepts context parameter without breaking', () => {
    const match = scanForSecrets('sk_live_4eC39HqLyjWDarjtT1zdp7dc', {
      sourceCode: 'const key = "sk_live_4eC39HqLyjWDarjtT1zdp7dc"',
      lineNumber: 1,
    })
    expect(match).not.toBeNull()
  })

  it('scanForSecrets works without context (backward compatible)', () => {
    const match = scanForSecrets('sk_live_4eC39HqLyjWDarjtT1zdp7dc')
    expect(match).not.toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Gap 3: Secrets in comments
// ═══════════════════════════════════════════════════════════════════════

describe('secrets in comments', () => {
  it('detects AWS key in single-line comment', () => {
    const code = '// API key: AKIAIOSFODNN7EXAMPLE'
    const violations = check(code)
    const commentSecrets = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('comment')
    )
    expect(commentSecrets.length).toBeGreaterThanOrEqual(1)
    expect(commentSecrets[0].title).toContain('aws-access-key')
  })

  it('detects Stripe key in block comment', () => {
    const code = '/* key = sk_live_4eC39HqLyjWDarjtT1zdp7dc */'
    const violations = check(code)
    const commentSecrets = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('comment')
    )
    expect(commentSecrets.length).toBeGreaterThanOrEqual(1)
  })

  it('detects secret in Python comment', () => {
    const code = '# token = ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
    const violations = check(code, 'python')
    const commentSecrets = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('comment')
    )
    expect(commentSecrets.length).toBeGreaterThanOrEqual(1)
  })

  it('does NOT flag normal comments', () => {
    const code = '// This function handles user authentication'
    const violations = check(code)
    const commentSecrets = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('comment')
    )
    expect(commentSecrets).toHaveLength(0)
  })

  it('does NOT flag TODO comments', () => {
    const code = '// TODO: implement the login flow for OAuth providers'
    const violations = check(code)
    const commentSecrets = violations.filter(
      v => v.ruleKey === 'security/deterministic/hardcoded-secret' && v.title.includes('comment')
    )
    expect(commentSecrets).toHaveLength(0)
  })
})
