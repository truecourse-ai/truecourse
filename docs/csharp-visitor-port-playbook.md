# C# visitor port — playbook

How to port one domain's deterministic code rules to C#. The architecture
domain (`packages/analyzer/src/rules/architecture/visitors/csharp/`) is the
worked example; `docs/CSHARP_ANALYZE_PLAN.md` §4–5 has the design.

## Per-rule process

For every rule key that has a `visitors/javascript/` or `visitors/python/`
implementation in your domain:

1. Read the JS and Python visitors. The rule's intent is in
   `<domain>/deterministic.ts` (key, name, description) — port the INTENT,
   not the syntax.
2. Decide the C# disposition:
   - **port** — the defect exists in C#; write `visitors/csharp/<rule>.ts`
   - **partial** — portable with a documented recall limitation; write the
     visitor AND report the limitation
   - **not-applicable** — the C# compiler rejects the code or the construct
     doesn't exist (e.g. JSX, `==` coercion, decorators-as-functions,
     Python-only frameworks). No visitor; report the reason.
   - **unsupported** — applicable but needs something we don't have (type
     checker, runtime info). No visitor; report the reason.
3. Framework-specific rules map across ecosystems: Express/Flask middleware →
   ASP.NET middleware/filters; Sequelize/SQLAlchemy → EF Core/Dapper;
   axios/requests → HttpClient. If the C# ecosystem analog is real, port
   against it; if the rule is inherently about a JS/Python library with no
   C# counterpart, it's not-applicable.

## Writing a visitor

- Copy the structure of an existing C# visitor (e.g.
  `architecture/visitors/csharp/duplicate-import.ts`):
  `ruleKey` (UNCHANGED from the catalog), `languages: ['csharp']`,
  `nodeTypes`, `visit()` returning `makeViolation(...)` or null.
- Shared helpers: `rules/_shared/csharp-helpers.ts` (method names, receivers,
  string text, enclosing function, modifiers, attributes) and
  `rules/_shared/csharp-framework-detection.ts` (ORM/ASP.NET detection,
  controller/minimal-API shapes, auth attributes). Extend a domain-local
  `visitors/csharp/_helpers.ts` for domain-specific logic.
- C# grammar facts (tree-sitter-c-sharp 0.23):
  - calls: `invocation_expression` fields `function`/`arguments`; member
    access: `member_access_expression` fields `expression`/`name`
  - strings: `string_literal` / `verbatim_string_literal` /
    `interpolated_string_expression`; content in `string_literal_content`
  - call args wrap in `argument`, attribute args in `attribute_argument`
  - modifiers are `modifier` children whose text is the keyword
  - file-scoped `namespace X;` is a SIBLING of the declarations after it
  - statements: `local_declaration_statement`, loops `for_statement` /
    `foreach_statement` / `while_statement`, `try_statement` with
    `catch_clause`, lambdas `lambda_expression`
- To check a node shape, parse a snippet in a scratch vitest test with
  `parseCode(code, 'csharp')` and print the tree, or run a node script
  importing `packages/analyzer/dist/index.js` (absolute path).

## Registration & tests

- Register every visitor in your domain's `visitors/csharp/index.ts`
  (`<DOMAIN>_CSHARP_VISITORS`). The combined checker already imports it.
- Tests: `tests/analyzer/csharp-<domain>-rules.test.ts`, mirroring
  `csharp-architecture-rules.test.ts` — for each ported rule at least one
  positive (realistic violating C#) and one negative (correct C# that must
  NOT fire). Realistic code only — no synthetic foo/bar scaffolding.
- Run from the worktree root (vitest runs from source, do NOT build):
  `npx vitest run tests/analyzer/csharp-<domain>-rules.test.ts`

## Boundaries

- Touch ONLY: `rules/<your-domain>/visitors/csharp/**` and
  `tests/analyzer/csharp-<your-domain>-rules.test.ts`.
- Do NOT edit `combined-code-checker.ts`, `language-support.ts`, shared
  helpers, or other domains. Report dispositions (rule key → status +
  reason) for central registration in `RULE_LANGUAGE_DISPOSITIONS`.
