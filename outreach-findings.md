# TrueCourse 0.5.7 — Run Findings + False Positive Report

Tool: `npx truecourse@latest analyze --no-llm --no-skills --no-stash` (version 0.5.7 from npm).
Targets cloned shallow to `/tmp/tc-targets/`:
- `documenso` (TS) — Next.js + Prisma e-signing platform
- `OpenHands` (Python + TS) — AI coding agent

## Headline numbers (0.5.7)

| Repo | Files | Services | Total | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|---|
| documenso | 1,735 | 15 | 57,351 | 18 | 4,929 | 48,182 | 4,222 |
| OpenHands | 1,461 | 15 | 25,115 | 69 | 1,014 | 14,510 | 9,522 |

## TL;DR

The critical tier — the one we'd want to lead a Discord post with — has a **near-100% false-positive rate on documenso (0/18 real) and ~93% on OpenHands (~5/69 plausibly real)**. Posting these results to either project's Discord today would be embarrassing. The high tier is mixed: a few rules are clean (`circular-module-dependency`, `blocking-call-in-async`, `asyncio-dangling-task`, `bare-except`) and a handful of rules are FP-storms driving most of the volume (`argument-type-mismatch` ~4.2k findings combined, `uncaught-exception-no-handler` per-file when it should be project-level, `missing-transaction` triggering on non-DB awaits).

This report enumerates each FP class, names the rule bug, and lists the genuine findings buried in the noise.

---

## Part 1 — Critical-tier false positives

### documenso — 18 critical, 0 real (100% FP)

#### `security/deterministic/hardcoded-secret` — 15 of 15 are FPs

Every hit matched on **identifier name**, not value. The rule appears to flag any string containing `token` / `secret` / `key` regardless of whether the assignment is a credential.

| File:Line | What it is | Why it's a FP |
|---|---|---|
| `packages/auth/server/lib/errors/error-codes.ts:7` | `InvalidToken: 'INVALID_TOKEN'` | Error-code enum value |
| `packages/auth/server/lib/errors/error-codes.ts:8` | `MissingToken: 'MISSING_TOKEN'` | Error-code enum value |
| `packages/lib/constants/email.ts:18` | `USER_SIGNUP_VERIFICATION_TOKEN_IDENTIFIER = 'confirmation-email'` | String identifier — name pattern triggers, value is harmless |
| `packages/lib/constants/organisations.ts:130` | `ORGANISATION_ACCOUNT_LINK_VERIFICATION_TOKEN_IDENTIFIER = 'organisation-account-link'` | Same pattern |
| `packages/lib/server-only/webhooks/trigger/generate-sample-data.ts` lines 62, 83, 140, 221, 243, 279, 301, 325, 347, 454, 478 (×11) | `token: 'SIGNING_TOKEN'` | File literally named **`generate-sample-data.ts`** — these are mock webhook payloads for testing |

#### `security/deterministic/os-command-injection` — 2 of 2 are FPs

`packages/ui/primitives/multiselect.tsx:284, 310` flag `void exec()`. Verified: `exec` is a **local async arrow function** declared 12 lines earlier in the same `useEffect`:

```ts
const exec = async () => {
  if (!onSearchSync || !open) return;
  if (triggerSearchOnFocus) doSearchSync();
  if (debouncedSearchTerm) doSearchSync();
};
void exec();
```

Rule has no scope analysis — any call to a function named `exec` triggers regardless of import.

#### `bugs/deterministic/conditional-hook` — 1 of 1 is a FP

`packages/ui/components/client-only.tsx:9` — `useHydrated()` is called at the top level of the component; the conditional is on its return value driving the JSX choice. The hook itself is unconditional.

---

### OpenHands — 69 critical, ~5 plausible real (~93% FP)

#### `security/deterministic/hardcoded-secret` — 27 of 32 are FPs

Same pattern: identifier-name matches, mock placeholders, env-var names, comment contents.

| Pattern | Count | Examples |
|---|---|---|
| Permission/enum names | 2 | `MANAGE_SECRETS = 'manage_secrets'`, `MANAGE_API_KEYS = 'manage_api_keys'` (`authorization.py:51,63`) |
| Token in **comment** sample payload | 1 | `slack.py:300` — line is a `#` comment showing what a Slack event JSON looks like; rule scans comments |
| React Query keys | 2 | `API_KEYS_QUERY_KEY = "api-keys"`, `LLM_API_KEY_QUERY_KEY = "llm-api-key"` |
| localStorage key name | 1 | `INVITATION_TOKEN_KEY = "openhands_invitation_token"` |
| i18n string constant | 1 | `BITBUCKET_DATA_CENTER$CONNECT_TO_BITBUCKET_DATA_CENTER = "..."` |
| Mock data with `**********` placeholder | 13 | `frontend/src/mocks/org-handlers.ts` — `llm_api_key: "**********"` repeated |
| Env-var **names** (not values) | 4 | `service_types.py:52,62,72,82` — `'tokenEnvVar': 'GITHUB_TOKEN'`, `'GITLAB_TOKEN'`, etc. |
| Env-var name + masked placeholder | 2 | `SESSION_API_KEY_VARIABLE = 'OH_SESSION_API_KEYS_0'`, `MASKED_API_KEY = '**********'` |
| Identifier-style enum value | 1 | `REMOTE_API_KEY = 'openhands_api'` |

The 5 plausible TPs:
- `enterprise/server/routes/integration/{bitbucket,bitbucket_dc,gitlab}.py` — `webhook_secret: str | None = 'localdeploymentwebhooktesttoken'` (×3) — defaults that fall through if config missing. Worth flagging.
- `openhands/app_server/server_config/server_config.py:12` and `default_web_client_config_injector.py:24` — `posthog_client_key = 'phc_...'` (×2). Real string, but PostHog **client** keys are public-by-design (shipped to browsers). Maintainers will say "intentional."

#### `bugs/deterministic/conditional-hook` — 31 of 31 are FPs

All 31 are calls of the form `useStore.getState().something(...)` inside event handlers, WebSocket message handlers, or service modules — **not React components**. This is the canonical Zustand pattern for accessing store state outside React. Examples:

```ts
// frontend/src/services/observations.ts:30
useBrowserStore.getState().setScreenshotSrc(message.extras.screenshot);

// frontend/src/contexts/conversation-websocket-context.tsx:182
useMetricsStore.getState().setMetrics(metrics);
```

The rule appears to match `use*(...).getState()` and assume hook-call semantics. It needs to recognize that `.getState()` on a Zustand-style hook is *not* a hook call — it's a static method on the hook function.

#### `security/deterministic/hardcoded-database-password` — 2 of 2 are FPs

`enterprise/migrations/env.py:59` and `openhands/app_server/app_lifespan/alembic/env.py:80`:

```python
url = f'postgresql://{DB_USER}:{DB_PASS}@{DB_HOST}:{DB_PORT}/{database_name}'
```

The password is **interpolated from a variable** (`{DB_PASS}`). The rule is matching the f-string pattern, not an actual hardcoded value. Needs to inspect the interpolation expression and only fire when the password slot is a string literal.

#### `database/deterministic/unsafe-delete-without-where` — 2 of 2 are FPs (or, intentional)

- `enterprise/migrations/versions/046_delete_all_slack_users.py:22` — `op.execute('DELETE FROM slack_users')`
- `enterprise/migrations/versions/057_enable_solvability_analysis_for_all_users.py:23` — `op.execute('UPDATE user_settings SET enable_solvability_analysis = true')`

Both are Alembic migrations whose **purpose** is the bulk operation. The filenames literally describe the intent. Rule should skip files under `migrations/versions/`.

#### `bugs/deterministic/undefined-local-variable` — 2 of 2 are FPs (rule has a real bug)

`enterprise/storage/saas_settings_store.py:106` and `enterprise/storage/user_store.py:977` claim "`normalized` is used before being assigned in this scope — `NameError` at runtime."

Actual code at line 106:
```python
kwargs = {
    **{
        normalized: getattr(org, c.name)         # line 106 — flagged here
        for c in Org.__table__.columns
        if (
            normalized := c.name.removeprefix('_default_')   # ← walrus assigns it
                              .removeprefix('default_')
                              .lstrip('_')
        ) in Settings.model_fields
    },
    ...
}
```

`normalized` is assigned via the **walrus operator** (`:=`) inside the `if` clause of the dict comprehension, and Python correctly scopes that assignment so the key expression can read it. **The rule doesn't model walrus assignments.** This is a real code-level bug in the analyzer, not just a calibration issue — needs an AST handler for `NamedExpr` nodes.

---

## Part 2 — High-tier rules: who's clean, who's noisy

Spot-checked the highest-volume high-severity rules. Calls below are based on 4-sample inspection, not full audit.

### Clean rules (high signal-to-noise — share-worthy)

| Rule | Repo | Count | Verdict |
|---|---|---|---|
| `architecture/deterministic/circular-module-dependency` | documenso | 5 | **Clean.** Real circular deps in `document-signing-auth-{password,passkey,account,2fa}.tsx` ↔ `document-signing-auth-provider`. |
| `bugs/deterministic/blocking-call-in-async` | OpenHands | 10 | **Clean.** Synchronous `requests.post/get` inside `async def` — real bug, fix is `httpx.AsyncClient`. |
| `bugs/deterministic/asyncio-dangling-task` | OpenHands | 7 | **Clean.** `asyncio.create_task(...)` with no reference held — task can be GC'd before completion. |
| `bugs/deterministic/bare-except` | OpenHands | 2 | **Clean.** Both have `# noqa: E722` already, devs know but kept them. |
| `security/deterministic/permissive-cors` | documenso | 1 | **Clean.** `Access-Control-Allow-Origin: '*'` in `apps/openpage-api/lib/cors.ts:43`. May be intentional but worth a question. |

### Noisy rules (high FP rate — need calibration before they're shareable)

| Rule | Combined count | FP cause |
|---|---|---|
| `bugs/deterministic/argument-type-mismatch` | 4,246 | Over-eager. Flags `defineConfig({...})` (Playwright/Vite/etc.), `await import("fs")`, framework `.map()` returns. The TypeScript compiler accepts these. |
| `reliability/deterministic/uncaught-exception-no-handler` | 60 | Per-file rule applied to every entry. Should be project-level — only the actual entrypoint needs `process.on('uncaughtException')`. |
| `database/deterministic/missing-transaction` | 163 | Flags non-DB awaits (e.g., `await loadedPdf.destroy()` in a PDF viewer), single writes (rule name says "multiple writes"), and writes already inside `tx.field.create(...)` blocks. |
| `architecture/deterministic/cross-service-internal-import` | 433 | Treats every `apps/remix → packages/ui` import as a service boundary violation. Whether this is a violation depends on intent — needs an explicit allowlist or boundary config. |
| `bugs/deterministic/array-callback-return` | 21 | Flags `array.map(async (x) => { await sideEffect() })` — async callbacks always return a Promise implicitly. Rule needs to recognize async arrows. |
| `code-quality/deterministic/system-exit-not-reraised` | 1 | `except SystemExit: ...; sys.exit(1)` — the `sys.exit(1)` IS the re-raise. Rule misses that. |

---

## Part 3 — Rule-level bugs to fix (prioritized)

These are concrete, testable. The first three account for the bulk of the FP volume.

1. **`hardcoded-secret`: stop matching identifier names.** Today the rule appears to look at variable/field names (`*_TOKEN`, `*_KEY`, etc.) and fires regardless of value. It should match on **value characteristics** — high-entropy strings, recognizable formats (JWT, AWS keys, etc.) — not name patterns. Also: skip strings inside comments, skip files under `**/mocks/**`, `**/fixtures/**`, `**/*sample*.ts`, `**/*sample*.py`.
2. **`conditional-hook`: recognize Zustand `useStore.getState()`.** When the call expression is `<hook>.getState().<method>(...)`, treat as a static method call, not a hook call.
3. **`argument-type-mismatch`: stop flagging valid TS calls.** Currently noisy enough to drown the rest of the report. Either tighten to high-confidence cases or demote severity.
4. **`undefined-local-variable`: handle Python walrus (`NamedExpr`).** Real analyzer bug — assignments via `:=` are not being entered into scope.
5. **`hardcoded-database-password`: inspect f-string interpolation slots.** Only fire when the password segment is a string literal, not when it's `{DB_PASS}` interpolated from a variable.
6. **`os-command-injection`: scope analysis on `exec`.** Don't fire on local function references — only on calls of `child_process.exec` (or aliased imports).
7. **`unsafe-delete-without-where`: skip migrations.** Add a path-pattern exclusion for `**/migrations/versions/**`, `**/alembic/versions/**`.
8. **`missing-transaction`: only fire on actual DB writes.** Currently triggers on any pair of awaits. Restrict to recognized ORM call sites (Prisma, SQLAlchemy, etc.) and skip when one of the calls is already inside a `prisma.$transaction(...)` / `tx.*` block.
9. **`uncaught-exception-no-handler`: make project-level.** Fire once per project if no `process.on('uncaughtException')` is registered, not per-file.
10. **`array-callback-return`: recognize async callbacks** as implicitly returning a Promise.

---

## Part 4 — Findings actually worth filing

The handful of items I'd send to maintainers, one per repo, after manually verifying:

### documenso
**`apps/openpage-api/lib/cors.ts:43` — wildcard CORS origin**
```ts
headers.set('Access-Control-Allow-Origin', '*');
```
Public-facing API. Probably worth a "is this intentional?" issue. Backup: the 5-instance circular dependency in the document-signing auth flow.

### OpenHands
**`enterprise/server/routes/integration/jira.py:483, 493, 523` — blocking `requests.*` in async**
```python
response = requests.post(JIRA_TOKEN_URL, json=token_payload)   # async fn
response = requests.get(JIRA_RESOURCES_URL, headers=headers)
jira_user_response = requests.get(JIRA_USER_INFO_URL, headers=headers)
```
Synchronous HTTP inside `async def` blocks the event loop on every Jira OAuth callback. Total of 10 instances across `jira.py` and `jira_dc.py`. Clean fix: `httpx.AsyncClient`. Backup picks: `enterprise/saas_server.py:169` (CORS middleware order) and the 7 `asyncio.create_task(...)` dangling tasks.

---

## Suggested next steps

1. **Don't post 0.5.7 results to any Discord yet** — the FP rate at the critical tier will torpedo credibility.
2. **Prioritize fixes 1–4** in Part 3. Those alone would drop documenso's critical from 18 → ~0 and OpenHands' from 69 → ~5, and the 5 remaining would actually be real findings worth reading.
3. **Turn each FP class into a fixture** under `tests/fixtures/sample-{js,python}-project-positive/` — that's exactly the battle-test cycle. The cases above are concrete and minimal.
4. **Re-run on the same two repos after fixes**, compare critical-tier deltas. If the fixed run shows ~0–10 critical and they're all real, *that's* the run worth posting.

## Reproduce

```bash
cd /tmp/tc-targets/documenso && npx -y truecourse@latest analyze --no-llm --no-skills --no-stash
cd /tmp/tc-targets/OpenHands && npx -y truecourse@latest analyze --no-llm --no-skills --no-stash
```

Snapshots: `/tmp/tc-targets/{documenso,OpenHands}/.truecourse/LATEST.json`
Logs: `/tmp/tc-targets/{documenso,openhands}-analyze.log`

Note: `--no-stash` is accepted but missing from `truecourse analyze --help` in 0.5.7 — surface it in the next release.
