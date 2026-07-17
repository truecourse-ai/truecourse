# OSS target repos for spec/guard battle-testing

Curated 2026-07-14 (verified via `gh`: language, CLI entry point, spec files exist, real bug issues). Goal: run `truecourse spec scan` + `guard generate`/`guard run` against real CLI tools whose repos contain behavioral specs, ideally with reported bugs that are spec-vs-code deviations.

**Selection criteria** (all must hold):
1. CLI tool (real binary/console-script, not a pure library)
2. Written in TS/JS, Python, or C# (analyzer-supported languages)
3. Behavioral spec docs in the repo, or implements a published external spec (CommonMark, SemVer, Conventional Commits, …)
4. Active issue tracker with bug reports — gold cases are "docs say X, tool does Y"

**Recipe note**: recipe discovery is ecosystem-aware (JS/TS, Python, C# — landed with #762) and handles python3/venv/pyenv setups; Tier 2 no longer needs a hand-written `recipe.json`. A committed `.truecourse/scenarios/recipe.json` still short-circuits discovery when present.

## Tier 1 — runnable with recipe discovery today (JS/TS)

| Repo | Lang | Spec | Example deviation bugs | Fit |
|---|---|---|---|---|
| conventional-changelog/commitlint | TS | Conventional Commits + `docs/reference/rules.md` | #4656, #4640, #4620, #4704 | ★★★★★ |
| npm/node-semver | JS | SemVer 2.0.0; README = range-grammar spec | #775, #757, #751 | ★★★★★ — smallest; best first run |
| stylelint/stylelint | JS | 150 per-rule specs in `lib/rules/<rule>/README.md` | #9320, #9252 | ★★★★★ |
| markedjs/marked | JS | CommonMark+GFM, spec JSON in `test/specs/` | #3996, #4002, #4011 | ★★★★★ |
| editorconfig/editorconfig-core-js | TS | EditorConfig spec + official conformance suite (submodule) | #118, #92, #86 | ★★★★½ |
| DavidAnson/markdownlint-cli2 | JS | per-rule `doc/mdXXX.md` — in the paired `markdownlint` lib repo (no CLI there; point at both) | markdownlint #1864, #1481, #1393 | ★★★★ |
| json5/json5 | JS | JSON5 spec (json5.org/spec) | #273, #67 | ★★★½ — thin CLI, quiet tracker |
| janl/mustache.js | JS | Mustache official spec (submodule `spec/`) | #826, #845 | ★★★★ |
| prettier/prettier | JS | `docs/rationale.md`, `options.md` | #19588, #19533 | ★★★★ — huge codebase, heavier |

## Tier 2 — need manual recipe.json until #762 (Python)

| Repo | Lang | Spec | Example deviation bugs | Fit |
|---|---|---|---|---|
| sqlfluff/sqlfluff | Py | per-rule docstring specs + dialect grammars | #8112, #8110, #8074 | ★★★★★ — already scanned (see status below) |
| executablebooks/markdown-it-py | Py | CommonMark; fixtures `tests/test_cmark_spec/` | #351 (spec-version gap), #377, #376 | ★★★★★ |
| koxudaxi/datamodel-code-generator | Py | JSON Schema / OpenAPI | #3325, #3073, #3048 | ★★★★½ |
| python-jsonschema/jsonschema | Py | JSON Schema official test suite | #1465, #1460, #1497 | ★★★★½ — CLI is deprecated (caveat) |
| psf/black | Py | `docs/the_black_code_style/` | #5225 (many others are crashes — filter) | ★★★★ |
| PyCQA/isort | Py | `docs/configuration/` output-mode specs | #2352 (idempotency), #2037, #1882 | ★★★★ |
| adrienverge/yamllint | Py | `docs/rules.rst` + per-rule docstrings | #799, #806, #805 | ★★★★ |
| wireservice/csvkit | Py | per-command `docs/scripts/*.rst` (14 tools) | #1237, #1145 | ★★★★ |
| noahmorrison/chevron | Py | Mustache official spec (submodule) | #117, #112 | ★★★★ — maintenance-light since 2023 |
| httpie/cli | Py | `docs/` request-building rules | #1642, #1640 | ★★★½ |

## Tier 3 — C# (manual recipe; dotnet tool)

| Repo | Lang | Spec | Example bugs | Fit |
|---|---|---|---|---|
| belav/csharpier | C# | own style docs + input→`.expected` corpus (not an external standard) | #1882, #1857, #1867 | ★★★½ — only viable C# candidate |

Rejected C# (spec but **no CLI**): StubbleOrg/Stubble (Mustache), xoofx/Tomlyn (TOML), xoofx/Markdig (CommonMark), RicoSuter/NJsonSchema (CLI lives in NSwag).

## Status log

- **sqlfluff** (2026-07-15): `spec scan` done — 14 conflicts flagged, only 3 legit (11 false: 5 from the `sqlfluffrs/` Rust-rewrite doc grouping, 1 manufactured by the 120-line truncation, rest omission/quantifier noise). `guard generate` produced 106 birth findings — **all bogus**: recipe discovered as `{"build":"true","entry":["true"]}`, every scenario ran against `/usr/bin/true`. Redo after #762 or with a hand-written recipe:
  ```json
  { "build": "python -m venv .venv && .venv/bin/pip install -e .", "entry": [".venv/bin/sqlfluff"] }
  ```
- Related issues filed from these runs: #757 (conflict-review CLI surface), #758 (overlap detector 120-line truncation), #759 (verify-pass over flagged overlaps), #760 (delete relation-detection stage), #762 (ecosystem-aware recipe discovery + no-op hardening + birth anomaly detection).

## Suggested run order

1. **node-semver** — smallest, JS (discovery works), README-as-spec; validates the pipeline end-to-end cheaply.
2. **commitlint** — the serious TS target (best-supported language, per-rule docs).
3. **marked** or **markdown-it-py** — conformance-suite targets where bugs map 1:1 to spec sections.
4. **sqlfluff** redo once the recipe path is fixed.
