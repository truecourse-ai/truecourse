# Secret Detection Research: Gitleaks vs TrueCourse

Research date: 2026-04-03

## Current State (TrueCourse)

Our detection in `packages/analyzer/src/rules/code-visitors/universal.ts` uses **6 hardcoded regex patterns** with 4 layers of false-positive filtering (structural, variable name, name exclusions, value content exclusions). No entropy checks, no stopwords, no per-rule allowlists, no keyword pre-filtering.

### Current Patterns

```typescript
const SECRET_PATTERNS = [
  /^(?:sk|pk)[-_](?:live|test)[-_]/i,              // Stripe-like
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,    // GitHub tokens
  /^(?:eyJ)[A-Za-z0-9_-]{20,}\.eyJ/,               // JWT tokens
  /^AKIA[0-9A-Z]{16}/,                              // AWS access keys
  /^xox[bporsac]-[0-9]{10,}/,                       // Slack tokens
  /(?:password|passwd|secret|api_?key|apikey|token|auth)[\s]*[:=][\s]*['"][^'"]{8,}['"]/i,
]
```

### Current FP Reduction (4 layers)

1. **Structural filtering** — ignores dictionary/object keys, only checks values
2. **Variable name-based detection** — checks if assigned to secret-like variable names
3. **Non-secret name exclusions** — skips variables named `uri`, `url`, `endpoint`, `type`, `scope`, etc.
4. **Value content exclusions** — skips URLs, literals (`true`, `false`, `Bearer`), strings with special chars (`[`, `]`, `<`, `>`, `{`, `}`, etc.)

---

## Gitleaks Overview

Gitleaks is the state-of-the-art open-source secret detection tool (Go-based, 3,200+ lines of TOML config). It defines **178 rule IDs** covering specific secret types across 5 false-positive reduction mechanisms.

### Rule Structure

Each rule is a TOML `[[rules]]` table:

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique rule identifier, e.g. `"aws-access-token"` |
| `description` | string | Human-readable explanation |
| `regex` | string | Regex for detecting the secret in content |
| `path` | string | Regex matched against file paths |
| `secretGroup` | int | Which regex capture group contains the actual secret (default: first group) |
| `entropy` | float | Minimum Shannon entropy the captured secret must have |
| `keywords` | []string | Fast pre-filter — content must contain at least one keyword before regex runs |
| `tags` | []string | Metadata/reporting tags |
| `[[rules.allowlists]]` | table array | Per-rule false positive suppression |

### Three Categories of Rules

**Category A: Prefix/format-based (~60% of rules, highest precision)**

These match secrets with known, distinctive prefixes:

```toml
[[rules]]
id = "stripe-access-token"
regex = '''\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})(?:[\x60'"\s;]|\\[nr]|$)'''
entropy = 2
keywords = ["sk_test", "sk_live", "sk_prod", "rk_test", "rk_live", "rk_prod"]

[[rules]]
id = "aws-access-token"
regex = '''\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b'''
entropy = 3
keywords = ["a3t", "akia", "asia", "abia", "acca"]

[[rules]]
id = "gcp-api-key"
regex = '''\b(AIza[\w-]{35})(?:[\x60'"\s;]|\\[nr]|$)'''
entropy = 4
keywords = ["aiza"]
```

**Category B: Context-based (~35% of rules, medium precision)**

Require a service name keyword near an assignment operator + value pattern:

```toml
[[rules]]
id = "datadog-access-token"
regex = '''(?i)[\w.-]{0,50}?(?:datadog)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([a-z0-9]{40})(?:[\x60'"\s;]|\\[nr]|$)'''
keywords = ["datadog"]
```

The reusable "assignment context" regex fragment:
```
(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}
```
Matches `=`, `>`, `:`, `::=`, `=>`, `?=`, `,` — covers JS, Python, YAML, TOML, env files, Go.

**Category C: Generic catch-all (lowest precision, heaviest suppression)**

```toml
[[rules]]
id = "generic-api-key"
regex = '''(?i)[\w.-]{0,50}?(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passw(?:or)?d|secret|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3})(?:[\x60'"\s;]|\\[nr]|$)'''
entropy = 3.5
keywords = ["access", "api", "auth", "key", "credential", "creds", "passwd", "password", "secret", "token"]
```

This rule requires **1,456 stopwords** and **4 separate allowlists** to be usable.

---

## Gitleaks False Positive Reduction — 5 Mechanisms

### Mechanism 1: Keywords (pre-filter)

Keywords are checked via fast string comparison BEFORE regex. If none of the rule's keywords appear in the content, the regex is never run. Keywords are always lowercased; the engine does case-insensitive substring matching.

```toml
keywords = ["sk_test", "sk_live", "sk_prod"]
```

### Mechanism 2: Entropy threshold

Shannon entropy is computed on the captured secret group. If entropy is below the threshold, the finding is discarded. This filters out placeholder values, repeated characters, and common words.

Entropy ranges used:
- `1.0` — very permissive (nuget config passwords)
- `2.0` — common for prefix-based rules (prefix provides confidence)
- `3.0` — standard for context-based rules
- `3.5` — generic-api-key (needs higher bar)
- `4.0–4.5` — strict (GCP, Dynatrace, Artifactory)

~130 of 178 rules use entropy checks.

### Mechanism 3: Allowlists (per-rule and global)

Each `[[rules.allowlists]]` entry supports:

| Field | Purpose |
|---|---|
| `condition` | `"OR"` (default) or `"AND"` |
| `regexes` | Regex patterns to match against the finding |
| `regexTarget` | What to match: `"secret"`, `"match"`, or `"line"` |
| `paths` | Path regex patterns |
| `stopwords` | Substrings checked against the extracted secret |

Example from generic-api-key:

```toml
# Secret is all letters/dots/dashes (no digits = not a real secret)
[[rules.allowlists]]
regexes = ['''^[a-zA-Z_.-]+$''']

# Match contains known non-secret patterns like "api_id", "key_name"
[[rules.allowlists]]
regexTarget = "match"
regexes = ['''(?i)(?:access(?:ibility|or)|access[_.-]?id|api[_.-]?(?:id|name|version)|...)''']

# Line-level patterns (Docker secrets, JS imports)
[[rules.allowlists]]
regexTarget = "line"
regexes = ['''--mount=type=secret,''', '''import[ \t]+{[ \t\w,]+}[ \t]+from[ \t]+['"][^'"]+['"]''']
```

### Mechanism 4: Stopwords

Substrings checked against the extracted secret value. If any stopword is found, the finding is suppressed. The generic-api-key rule has 1,456 stopwords:

```
"000000", "aaaaaa", "abstract", "account", "admin", "algorithm",
"android", "angular", "apache", "archive", "async", "azure",
"backend", "bootstrap", "buffer", "cache", "calendar", "chrome",
"client", "cluster", "compile", "component", "config", "console",
"container", "controller", "database", "debug", "default", ...
```

### Mechanism 5: Global path exclusions

```toml
[allowlist]
paths = [
    '''gitleaks\.toml''',
    '''(?i)\.(?:bmp|gif|jpe?g|png|svg|tiff?)$''',           # Images
    '''(?i)\.(?:eot|[ot]tf|woff2?)$''',                      # Fonts
    '''(?i)\.(?:docx?|xlsx?|pdf|bin|exe|dll|pdb)$''',         # Binaries
    '''go\.(?:mod|sum)$''',                                    # Go deps
    '''(?:^|/)node_modules(?:/.*)?$''',                        # node_modules
    '''(?:^|/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$''', # Lock files
    '''(?:^|/)(?:angular|bootstrap|jquery)[a-zA-Z0-9.-]*\.min\.js$''', # Minified
    '''(?i)(?:^|/)(?:v?env|virtualenv)/lib(?:64)?(?:/.*)?$''', # Python venvs
]
```

Global regex allowlists filter template/variable patterns:

```toml
regexes = [
    '''(?i)^true|false|null$''',                               # Literals
    '''^\$(?:\d+|{\d+})$''',                                   # Positional params ($1)
    '''^\$(?:[A-Z_]+|[a-z_]+)$''',                             # Env var refs ($MY_VAR)
    '''^\${(?:[A-Z_]+|[a-z_]+)}$''',                           # ${MY_VAR}
    '''^\{\{[ \t]*[\w ().|]+[ \t]*}}$''',                      # {{ template }}
    '''^\$\{\{[ \t]*(?:env|github|secrets|vars)\..*}}$''',     # GitHub Actions
    '''^%(?:[A-Z_]+|[a-z_]+)%$''',                             # Windows env vars
    '''^@(?:[A-Z_]+|[a-z_]+)@$''',                             # Autoconf vars
    '''^/Users/(?i)[a-z0-9]+/[\w .-/]+$''',                   # macOS paths
    '''^/(?:bin|etc|home|opt|tmp|usr|var)/[\w ./-]+$''',       # Unix paths
]
```

---

## Advanced Features

### secretGroup

Specifies which capture group is the actual secret (for entropy checking and reporting):

```toml
[[rules]]
id = "sonar-api-token"
regex = '''(?i)[\w.-]{0,50}?(?:sonar[_.-]?(login|token))(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}((?:squ_|sqp_|sqa_)?[a-z0-9=_\-]{40})(?:[\x60'"\s;]|\\[nr]|$)'''
secretGroup = 2  # Group 1 is "login|token", group 2 is the actual secret
```

### Path-only rules

Detect sensitive files purely by path:

```toml
[[rules]]
id = "pkcs12-file"
description = "Found a PKCS #12 file"
path = '''(?i)(?:^|\/)[^\/]+\.p(?:12|fx)$'''
```

### Composite rules (v8.28+)

Primary rules can require auxiliary rules to match nearby, with proximity constraints (`withinLines`, `withinColumns`). Enables multi-part detection like "API key appearing near a specific service URL."

---

## Full Coverage: Gitleaks Detected Secret Types (178 rules)

- **Cloud**: AWS (access token, Bedrock), GCP API key, Azure AD, Alibaba, DigitalOcean (3), Heroku (2), Flyio, Cloudflare (3)
- **AI/ML**: OpenAI, Anthropic (API + admin), Cohere, HuggingFace (2), Perplexity, PrivateAI
- **Payment**: Stripe, Square, Squarespace, Plaid (3), Coinbase, Flutterwave (3), GoCardless, Shopify (4)
- **CI/CD**: GitHub (5), GitLab (13+), Bitbucket (2), DroneCI, TravisCI
- **Messaging**: Slack (8), Discord (3), Telegram, Teams webhook, Gitter, Mattermost
- **Monitoring**: Datadog, Dynatrace, New Relic (4), Grafana (3), Sentry (3), Snyk, Sonar
- **Infra**: Terraform, Pulumi, Vault (2), K8s secrets, Netlify, PlanetScale (3), Docker
- **Crypto**: Private keys (PEM), PKCS12 files, Age secret keys, JWTs (2)
- **Generic**: generic-api-key (catch-all)
- **Misc**: ~100 more (Twilio, SendGrid, Mailchimp, NPM, PyPI, RubyGems, Postman, etc.)

---

## Gap Analysis: What We're Missing

| Gap | Current State | Gitleaks Approach |
|-----|---------------|-------------------|
| **Entropy checking** | Not implemented | Shannon entropy on captured group, per-rule thresholds |
| **Stopwords** | Not implemented | 1,456 stopwords on generic rule, global stopwords |
| **Template/variable exclusions** | Partial (special chars) | Comprehensive regex: `${VAR}`, `{{ }}`, `$ENV`, `%VAR%` |
| **Keyword pre-filtering** | Not implemented | Fast substring check before regex |
| **Per-rule allowlists** | Not implemented | Per-rule with `secret`/`match`/`line` targets |
| **Path exclusions** | `.gitignore` only | Lock files, vendor, binaries, images, fonts, minified JS |
| **Service-specific patterns** | 6 patterns | 178 rules covering major services |
| **secretGroup** | Not implemented | Specifies which capture group is the secret |
| **Path-only detection** | Not implemented | Detects sensitive files by extension (`.p12`, `.pem`) |
| **Suppression mechanism** | Not implemented | No inline `// truecourse-ignore` or allowlist files |

---

## Priority Improvements (ranked by FP reduction impact)

| Priority | Improvement | Impact on FPs | Effort |
|----------|-------------|---------------|--------|
| 1 | **Add entropy checking** | High — eliminates placeholder/test values | Medium |
| 2 | **Add stopwords list** for generic patterns | High — eliminates common words flagged as secrets | Low |
| 3 | **Add template/variable reference exclusions** | Medium — `${VAR}`, `{{ }}`, `$ENV_VAR` | Low |
| 4 | **Expand service-specific patterns** (prefix-based) | Medium — prefix rules have near-zero FPs | Medium |
| 5 | **Add path exclusions** for lock files, vendor, binaries | Medium — prevents scanning irrelevant files | Low |
| 6 | **Add keyword pre-filtering** | Low (perf) — speeds up scanning | Low |
| 7 | **Per-rule allowlists** | Low — surgical FP suppression | High |
