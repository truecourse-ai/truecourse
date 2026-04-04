# Rule Restructuring Plan

## Context

TrueCourse has 50 implemented rules using old key format `{category}/{name}` (e.g., `arch/circular-service-dependency`, `code/sql-injection`, `llm/db-missing-index`). The master catalog in ALL-RULES.md has 1,156 rules using the new format `{domain}/{detection}/{name}`. We need to migrate to the new format and restructure the codebase to match.

---

## New Rule Key Format

```
{domain}/{detection}/{name}
```

- **Domain:** architecture, security, bugs, code-quality, database, performance, reliability
- **Detection:** deterministic, llm
- **Name:** plain English, no `no-` prefix, no source tool IDs (S-numbers, etc.)

Examples:
- `arch/circular-service-dependency` → `architecture/deterministic/circular-service-dependency`
- `code/sql-injection` → `security/deterministic/sql-injection`
- `llm/db-missing-index` → `database/llm/missing-index`
- `llm/code-error-handling` → `bugs/llm/error-handling`

---

## Key Mapping: Old → New

### Architecture (from `arch/*` and `llm/arch-*`)

| Old Key | New Key |
|---------|---------|
| `arch/circular-service-dependency` | `architecture/deterministic/circular-service-dependency` |
| `arch/god-service` | `architecture/deterministic/god-service` |
| `arch/module-layer-data-api` | `architecture/deterministic/data-layer-depends-on-api` |
| `arch/module-layer-external-api` | `architecture/deterministic/external-layer-depends-on-api` |
| `arch/module-layer-data-external` | `architecture/deterministic/data-layer-depends-on-external` |
| `arch/cross-service-internal-import` | `architecture/deterministic/cross-service-internal-import` |
| `arch/god-module` | `architecture/deterministic/god-module` |
| `arch/unused-export` | `architecture/deterministic/unused-export` |
| `arch/dead-module` | `architecture/deterministic/dead-module` |
| `arch/orphan-file` | `architecture/deterministic/orphan-file` |
| `arch/long-method` | `architecture/deterministic/long-method` |
| `arch/too-many-parameters` | `architecture/deterministic/too-many-parameters` |
| `arch/deeply-nested-logic` | `architecture/deterministic/deeply-nested-logic` |
| `arch/dead-method` | `architecture/deterministic/dead-method` |
| `llm/arch-tight-coupling` | `architecture/llm/tight-coupling` |
| `llm/arch-missing-layers` | `architecture/llm/missing-layers` |
| `llm/arch-circular-module-dependency` | `architecture/llm/circular-module-dependency` |
| `llm/arch-deep-inheritance-chain` | `architecture/llm/deep-inheritance-chain` |
| `llm/arch-excessive-fan-out` | `architecture/llm/excessive-fan-out` |
| `llm/arch-excessive-fan-in` | `architecture/llm/excessive-fan-in` |
| `llm/arch-mixed-abstraction-levels` | `architecture/llm/mixed-abstraction-levels` |

### Security (from `code/*`)

| Old Key | New Key |
|---------|---------|
| `code/sql-injection` | `security/deterministic/sql-injection` |
| `code/hardcoded-secret` | `security/deterministic/hardcoded-secret` |

### Bugs (from `code/*` and `llm/code-*`)

| Old Key | New Key |
|---------|---------|
| `code/empty-catch` | `bugs/deterministic/empty-catch` |
| `code/mutable-default-arg` | `bugs/deterministic/mutable-default-arg` |
| `code/bare-except` | `bugs/deterministic/bare-except` |
| `llm/code-error-handling` | `bugs/llm/error-handling` |
| `llm/code-race-condition` | `bugs/llm/race-condition` |
| `llm/code-resource-leak` | `bugs/llm/resource-leak` |
| `llm/code-inconsistent-return` | `bugs/llm/inconsistent-return` |

### Code Quality (from `code/*` and `llm/code-*`)

| Old Key | New Key |
|---------|---------|
| `code/console-log` | `code-quality/deterministic/console-log` |
| `code/no-explicit-any` | `code-quality/deterministic/no-explicit-any` |
| `code/todo-fixme` | `code-quality/deterministic/todo-fixme` |
| `code/star-import` | `code-quality/deterministic/star-import` |
| `code/global-statement` | `code-quality/deterministic/global-statement` |
| `llm/code-misleading-name` | `code-quality/llm/misleading-name` |
| `llm/code-dead-code` | `code-quality/llm/dead-code` |
| `llm/code-security-misuse` | `security/llm/security-misuse` |
| `llm/code-magic-number` | `code-quality/llm/magic-number` |

### Database (from `llm/db-*`)

| Old Key | New Key |
|---------|---------|
| `llm/db-missing-foreign-key` | `database/llm/missing-foreign-key` |
| `llm/db-missing-index` | `database/llm/missing-index` |
| `llm/db-naming-inconsistency` | `database/llm/naming-inconsistency` |
| `llm/db-missing-timestamps` | `database/llm/missing-timestamps` |
| `llm/db-overly-nullable` | `database/llm/overly-nullable` |

---

## File Structure

Each domain is self-contained — rule definitions, visitors, and checker logic all live together.

```
packages/analyzer/src/rules/
├── index.ts                        ← registry, loads all domains
├── types.ts                        ← Rule, Visitor, Checker types
│
├── architecture/
│   ├── deterministic.ts            ← rule definitions
│   ├── llm.ts                      ← LLM rule definitions
│   ├── visitors/
│   │   ├── javascript.ts           ← JS/TS visitors (circular deps, unused exports, etc.)
│   │   └── python.ts
│   └── checker.ts                  ← orchestrates architecture checks
│
├── security/
│   ├── deterministic.ts
│   ├── llm.ts
│   ├── visitors/
│   │   ├── javascript.ts           ← sql-injection, eval, hardcoded-secret for JS
│   │   └── python.ts
│   └── checker.ts
│
├── bugs/
│   ├── deterministic.ts
│   ├── llm.ts
│   ├── visitors/
│   │   ├── javascript.ts           ← empty-catch for JS
│   │   └── python.ts               ← bare-except, mutable-default-arg for Python
│   └── checker.ts
│
├── code-quality/
│   ├── deterministic.ts
│   ├── llm.ts
│   ├── visitors/
│   │   ├── javascript.ts           ← console-log, star-import, no-explicit-any for JS
│   │   └── python.ts               ← global-statement for Python
│   └── checker.ts
│
├── database/
│   ├── llm.ts
│   └── checker.ts                  ← LLM-only, no visitors
│
├── performance/
│   ├── deterministic.ts
│   ├── visitors/
│   │   ├── javascript.ts
│   │   └── python.ts
│   └── checker.ts
│
└── reliability/
    ├── deterministic.ts
    ├── visitors/
    │   ├── javascript.ts
    │   └── python.ts
    └── checker.ts
```

### Design Decisions

**Files with multiple rules, not file per rule.** Each `deterministic.ts` / `llm.ts` contains all rules for that domain+detection combo. With 1,000+ rules, file-per-rule would create too many tiny files. Grouping by domain keeps related rules scannable.

**Visitors by domain+language, not one giant file per language.** The old `visitors/javascript.ts` with all JS visitors would grow to thousands of lines. Instead, each domain has its own `visitors/javascript.ts` and `visitors/python.ts`. When adding a new security rule for Python, you open `security/visitors/python.ts` — you never touch other domains.

**Each domain has its own checker.** The old service/module/code checker split was an implementation detail. Now each domain's `checker.ts` knows how to run its own rules — whether that requires the service graph, module metadata, or AST walking. The top-level `index.ts` just collects and runs all domain checkers.

---

## Database Migration

One-time idempotent SQL migration to update all rule keys across all tables:

```sql
-- Idempotent: only updates rows that still have old keys

-- rules table (primary key)
UPDATE rules SET key = 'architecture/deterministic/circular-service-dependency' WHERE key = 'arch/circular-service-dependency';
UPDATE rules SET key = 'architecture/deterministic/god-service' WHERE key = 'arch/god-service';
-- ... (one UPDATE per rule)

-- violations table
UPDATE violations SET "ruleKey" = 'architecture/deterministic/circular-service-dependency' WHERE "ruleKey" = 'arch/circular-service-dependency';
-- ... (same mapping)

-- code_violations table
UPDATE code_violations SET "ruleKey" = 'security/deterministic/sql-injection' WHERE "ruleKey" = 'code/sql-injection';
-- ... (same mapping)

-- deterministic_violations table
UPDATE deterministic_violations SET "ruleKey" = 'architecture/deterministic/circular-service-dependency' WHERE "ruleKey" = 'arch/circular-service-dependency';
-- ... (same mapping)
```

Also update the `category` column in `rules` table to use new domain values, and add a migration to update the `rules` table schema if needed.

---

## Naming Principles

- **Plain English names** — no tool-specific naming (no `no-` prefix from ESLint, no S-numbers from Sonar, no Ruff codes)
- **Not obvious we sourced from other tools** — our names describe the problem, not the source
- **Consistent** — all lowercase, hyphen-separated, descriptive

---

## Rule Sync (Private Repo)

For keeping our catalog current as linters release new rules. Lives in a separate private repo (`truecourse-rules-sync`), not committed to the main repo.

```
truecourse-rules-sync/
├── sources/                        ← scripts to fetch latest rules from each linter
│   ├── ruff.ts                     ← fetch from Ruff GitHub (crates/ruff_linter/src/codes.rs)
│   ├── eslint.ts                   ← fetch from ESLint GitHub
│   ├── sonar-python.ts             ← fetch from SonarPython GitHub
│   ├── sonar-js.ts                 ← fetch from SonarJS GitHub
│   ├── go-vet.ts                   ← (future) Go
│   ├── clippy.ts                   ← (future) Rust
│   ├── spotbugs.ts                 ← (future) Java
│   └── ...
├── snapshots/                      ← last-known versions of source rule files
│   ├── RUFF-RULES.md
│   ├── ESLINT-RULES.md
│   ├── SONAR-PYTHON-RULES.md
│   ├── SONARJS-RULES.md
│   └── ...
├── verify-rules.ts                 ← copied/linked from main repo
├── sync.ts                         ← main workflow: fetch → diff → verify → report
└── README.md
```

### Sync Workflow

1. **Fetch** — run source scripts to download latest rules from each linter's GitHub
2. **Diff** — compare fetched rules against snapshots to find only NEW rules since last sync
3. **Verify** — run new rules through verify-rules.ts against current ALL-RULES.md
4. **Review** — output a report of genuinely new rules (not already covered)
5. **Upsert** — approved rules get added to ALL-RULES.md in the main repo
6. **Update snapshots** — save fetched files as new snapshots

### Multi-Language Support

When adding a new language, add its linter sources to the sync repo. Many rules are cross-language concepts (SQL injection, hardcoded secrets, empty catch, eval). Those existing rules in ALL-RULES.md get their `Language` column updated (e.g., `python` → `python, go`) rather than creating duplicates.

| Language | Linters to Track |
|----------|-----------------|
| Python | Ruff, SonarPython |
| JS/TS | ESLint, @typescript-eslint, SonarJS |
| Go | go vet, staticcheck, golangci-lint |
| Java | SpotBugs, PMD, SonarJava, Error Prone |
| Rust | clippy |
| C# | Roslyn Analyzers, SonarC# |
| PHP | PHPStan, Psalm, SonarPHP |
