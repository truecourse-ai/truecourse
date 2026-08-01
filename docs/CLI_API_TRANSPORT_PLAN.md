# CLI API Transport — Direct-API LLM Option for OSS

STATUS: BUILT 2026-07-27 — all six phases, on PR #835; the open questions were resolved
by the owner the same day. This plan adds a **direct-API LLM transport** to the OSS CLI
as a first-class alternative to spawning the `claude` binary:
a first-run choice between **Claude Code (recommended)** and **API**, a saved selection,
CLI/config-file credential entry (never the dashboard), and a single user-chosen model for
all commands with the existing per-stage override mechanism still honored.

This supersedes the "OSS AI-SDK transport (decided 2026-07-07)" item in
`docs/SPEC_GUARD_PLAN.md` (env-only, no config-file key storage). The scope has grown:
persisted selection, config-file credentials, and a reconfigure command are now explicitly
in OSS. That plan item now carries a BUILT status pointing here.

## Requirements (from the product owner)

1. The CLI gains an **API transport option** using the same API-key approach the product
   already has (the EE provider config: provider + model + key).
2. **First run**: `truecourse` asks — "Claude Code (recommended)" or "API" — and **saves
   the selection**.
3. **Reconfigure**: a CLI path to change the selection later, the counterpart of how EE
   users reconfigure via the dashboard Models page.
4. **Credentials via CLI or config file only** — never enterable through the dashboard.
5. In API mode the user **must provide a model**, and that one model is used for **all
   commands** — except where the existing per-stage override mechanism
   (`TRUECOURSE_MODEL_<STAGE>` / `.truecourse/config.json#llm.stages`) explicitly says
   otherwise.

## Current state (what existed before this plan landed)

- **The seam.** `LlmTransport` is a single function type in
  `packages/shared/src/llm/transport.ts`: `(req: LlmRequest) => Promise<string>`. OSS has
  two implementations — `cliTransport` (spawns `claude -p`, the default) and
  `agentTransport` (filesystem mailbox). A third backend needs **no interface change**.
- **The install point.** `setDefaultTransport()` / `getDefaultTransport()` in the same
  file. EE already uses exactly this hook: `registerLlmProviders()`
  (`ee/packages/server/src/llm/index.ts`) installs `createAiSdkTransport(storedConfig)`
  at boot, or `noProviderTransport` when unconfigured. In OSS the default transport is
  never set, so each of the ~20 leaf runners falls back to `cliTransport()`.
- **Selection today.** `resolveTransport()` in `spec-in-process.ts` / `guard-in-process.ts`
  understands `'cli' | 'agent'` (the `--llm-transport` flag); analyze does
  `options.transport ?? getDefaultTransport()` and its legacy `LLMProvider`
  (`packages/core/src/services/llm/cli-provider.ts`) has a transport branch that is taken
  whenever a transport is present.
- **The EE provider stack** (`ee/packages/llm`, `@truecourse/ee-llm`): `ProviderConfig`
  (provider, model, fallbackModel, apiKey, baseURL, headers, Bedrock creds),
  `buildModel()` switching over `anthropic | openai | bedrock | copilot` via
  `@ai-sdk/*` packages, and `createAiSdkTransport()` — timeout via AbortController, one
  fallback-model retry, `generateObject` when `req.schema` is present, optional trace
  recorder. It depends only on `@truecourse/shared` — **not** on core or ee-db. Keys live
  encrypted (AES-256-GCM) in Postgres behind the ee Models page; none of that storage
  moves.
- **Per-stage models.** `packages/core/src/config/llm-models.ts`: 20 `StageId`s,
  `STAGE_DEFAULTS` mapping each stage to a Claude tier alias (`haiku`/`sonnet`/`opus`),
  and `resolveModel()` with precedence: per-stage env → `TRUECOURSE_MODEL` (legacy
  `CLAUDE_CODE_MODEL`) → repo `config.json#llm.stages` → in-code default.
  `truecourse config llm show` renders the resolution read-only.
- **Global config.** `~/.truecourse/config.json` is documented ("LLM keys, provider") but
  **vestigial — `getGlobalConfigPath()` has zero consumers**. We get to define its schema
  from scratch.
- **Pricing/estimates.** `model-prices.ts` prices by exact OpenRouter id or Claude tier
  substring; anything else returns null → the estimate marks cost partial.
  `spec-estimate.ts` calls `resolveModel()` per stage, so estimates automatically follow
  whatever resolution produces.
- **Guard rails.** `tests/architecture/ee-import-boundary.test.ts` currently forbids any
  static OSS import of `ai` / `@ai-sdk/*` — written when the AI SDK was EE-only. It must
  be amended (narrowly), not deleted.

## Design at a glance

```
                 first run (TTY, LLM command, no saved selection)
                 ┌──────────────────────────────────────────────┐
                 │ How should TrueCourse call the LLM?          │
                 │ › Claude Code (recommended)                  │
                 │   API (bring your own key)                   │
                 └──────────────┬───────────────────────────────┘
              claude-code       │        api → provider, model, key, probe
                    │           │                     │
                    ▼           ▼                     ▼
             ~/.truecourse/config.json   { llm: { transport, api: {...} } }  (0600)
                                │
        CLI command start / dashboard-server pipeline entry
                                │
                installConfiguredLlmTransport()          (packages/core, new)
                    │                        │
      transport=claude-code           transport=api
      (leave default unset —          setDefaultTransport(
       today's behavior, leaf           createApiTransport(cfg))   ← promoted from ee
       runners spawn `claude`)
```

One saved choice, one injection point, zero changes to the 20 leaf runners, and the
`--llm-transport` flag becomes a three-value per-run override: `cli | agent | api`.

## Decisions

Numbered like `SPEC_GUARD_PLAN.md`; each carries a STATUS. "PROPOSED" means awaiting
approval of this doc.

### 1. Selection + credentials live in the global config file. STATUS: BUILT 2026-07-27 (decided the same day)

`~/.truecourse/config.json` (respects `TRUECOURSE_HOME`), written with mode `0600` and the
global dir ensured `0700`. Schema (new `llm` block; the file may later grow siblings):

```jsonc
{
  "llm": {
    // The saved first-run selection. Absent = never chosen → first-run wizard.
    "transport": "claude-code" | "api",

    // Persisted independently of `transport`, so switching back and forth
    // never re-asks for credentials.
    "api": {
      "provider": "anthropic" | "openai" | "bedrock" | "copilot",
      "model": "claude-sonnet-4-5",          // REQUIRED in api mode
      "fallbackModel": "claude-haiku-4-5",   // optional, one retry on error
      "apiKey": "sk-ant-…",                  // optional if the env var is set
      "baseURL": "https://…",                // optional; gateways (LiteLLM/OpenRouter/Portkey)
      "headers": { "…": "…" },               // optional
      // Bedrock only (omit → ambient AWS credential chain):
      "region": "us-west-2", "accessKeyId": "…", "secretAccessKey": "…", "sessionToken": "…"
    }
  }
}
```

Why global and not per-repo: the per-repo `.truecourse/config.json` is **committable by
convention** — keys must never be near it; and the transport choice is per-user (like the
Claude Code login it replaces), not per-project. Per-repo does keep what it already has:
`llm.stages` / `llm.fallbackModel` overrides.

Env overrides (all optional, override the file):
- `TRUECOURSE_LLM_TRANSPORT=claude-code|api` — force the mode for a run/CI.
- Key fallback when `apiKey` is absent from the file: `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / ambient AWS chain (bedrock) / `COPILOT_API_KEY`. Users who refuse
  file-stored keys set `transport: api` + the env var and omit `apiKey`.

New core module `packages/core/src/config/global-config.ts`: typed read/write
(`readGlobalConfig()` / `updateGlobalConfig()`), permission enforcement, malformed-file →
treated as empty with a warning (same tolerance as `project-config.ts`).

Landed as `packages/core/src/config/global-config.ts` — plus `writeGlobalConfig()`,
`globalConfigMtimeMs()` (the dashboard's mtime re-check, item 4), and the mode/model
lookups `getConfiguredLlmMode()` / `apiModeModel()` / `apiModeFallbackModel()` that
`resolveModel` consumes (item 5). The schema gained one field the sketch above omits:
`api.apiKeyEnv`, the NAME of an env var holding the key, resolved per run — it is what
`--api-key-env` stores, and what the wizard writes when it detects the provider's standard
variable already set.

### 2. Provider scope: the same four as EE. STATUS: BUILT 2026-07-27 — all four shipped

`anthropic | openai | bedrock | copilot`, plus `baseURL` for OpenAI/Anthropic-protocol
gateways — i.e. the **same API-key approach** and `ProviderConfig` shape EE ships. No new
provider semantics are invented for OSS; the wizard's provider list, model placeholders,
and validation mirror the ee Models page (`ee/packages/client/src/ModelsPage.tsx`).

Alternatives rejected:
- *Anthropic-only via `@anthropic-ai/sdk`* — a second transport implementation to
  maintain, and it walls off users on OpenAI/Bedrock for no architectural win.
- *Env-only OpenAI-compatible single route* (the old SPEC_GUARD_PLAN item) — fails the
  first-run/save/reconfigure requirements.
- *Raw fetch, zero deps* — re-implements four providers' auth/streaming/structured-output
  by hand; workaround-grade.

### 3. Implementation: promote the EE transport core to OSS. STATUS: BUILT 2026-07-27 — the transport core moved out of `ee/`

Move `ee/packages/llm`'s provider-agnostic core — `types.ts` (`ProviderConfig`,
`LlmProviderKind`), `model.ts` (`buildModel`), `transport.ts` (`createAiSdkTransport`,
renamed export `createApiTransport`), `trace-context.ts` — to a new OSS workspace package
**`packages/llm-api` (`@truecourse/llm-api`, private)**. It already depends only on
`@truecourse/shared` + the AI SDK packages, so the move is mechanical.

- `@truecourse/ee-llm` becomes a thin re-export so EE server/client code and the
  `tests/ee-llm/*` suites keep compiling; EE keeps its encrypted store, Models page,
  probe route, and trace recorder unchanged.
- The trace `recorder` option stays — OSS simply doesn't pass one.
- `tests/architecture/ee-import-boundary.test.ts` changes from "OSS never imports
  `ai`/`@ai-sdk/*`" to "only `packages/llm-api` may import them" — the boundary intent
  (the SDK doesn't spread through OSS) survives; the single sanctioned home moves.
- One transport implementation serves both editions — no fork to keep in sync. The
  duplicated `LlmProviderKind` in `packages/shared/src/types/ee.ts` becomes the single
  shared definition.
- npm size note: `ai` + four `@ai-sdk/*` packages join the published CLI's dependency
  tree. Providers are constructed per configured provider only; if install weight proves
  to matter we can lazy-`import()` per provider later — not v1 scope.

Landed as `packages/llm-api` exporting `createApiTransport` (with `createAiSdkTransport`
kept as an alias for EE call sites), `buildModel`, the trace context, and `ProviderConfig`
/ `LlmProviderKind`, whose single definition now lives in `@truecourse/shared`.

### 4. Transport wiring: one injection point, flag stays an override. STATUS: BUILT 2026-07-27

New `packages/core/src/services/llm/install-transport.ts`:

```
installConfiguredLlmTransport():
  mode = TRUECOURSE_LLM_TRANSPORT || globalConfig.llm.transport
  if mode == 'api'  → validate api block → setDefaultTransport(createApiTransport(cfg, opts))
  else              → leave the default transport unset (exact current OSS behavior)
```

Called from: the CLI entry before any LLM-consuming command runs, and the dashboard
server at boot **plus lazily re-checked (config mtime) at each pipeline entry point** so
a `truecourse config llm setup` while the dashboard is running takes effect without a
restart (the store convention: cheap mtime-cached reads).

`resolveTransport()` (spec/guard in-process) gains the `'api'` branch, and the CLI flag
becomes `--llm-transport <cli|agent|api>` — an explicit per-run override of the saved
selection (`cli` forces Claude Code). Precedence: **flag > env > saved config > default
(claude-code)**. The `spec scan --llm-transport` / analyze / guard flags all align.

Analyze needs no work: `createLLMProvider(transport ?? getDefaultTransport())` already
takes the transport branch when one is installed — and that branch passes `req.schema`,
so analyze gets schema-enforced `generateObject` output in API mode for free.

EE is untouched: `registerLlmProviders()` still overrides the default transport at EE
boot from encrypted Postgres and never reads the global file (the "no CLI/.env fallback
in EE" rule holds).

Landed with three refinements:

- **`installConfiguredLlmTransport()` only ever clears its own transport.** It remembers
  the transport it installed and the config identity (path + mtime + env override) it came
  from; in claude-code mode it unsets the default only when the current one is still its
  own, so an EE-installed transport can never be dropped. The dashboard's
  `llm-transport.service.ts` additionally gates every call on `isEnterprise()`.
- **Explicit `--llm-transport cli` on analyze clears the installed default** rather than
  injecting a `cliTransport()`. Analyze reaches the model through its own `claude` spawn
  (schema-enforced via `--json-schema`); handing it a transport would switch it to the
  transport branch and lose that path. `spec`/`guard`'s `resolveTransport()` — which has no
  such spawn path — does return a fresh `cliTransport()` for explicit `cli`.
- **The CLI installs at preflight, not at entry.** `preflightLlmOrExit()`
  (`tools/cli/src/lib/claude-preflight.ts`) branches per transport (item 10); commands that
  run a pipeline without a preflight (`spec docs` re-scans, `hooks run`) call the install
  directly.

### 5. Model semantics in API mode: one model, existing overrides still win. STATUS: BUILT 2026-07-27

`llm.api.model` is required and becomes the model for **every stage of every command**.
Mechanism — one change inside `resolveModel()` / `describeStageResolutions()`:

- In API mode, resolution step 4 (the in-code `STAGE_DEFAULTS` tier alias) is replaced by
  `llm.api.model`, reported as source `api-config`. Tier aliases like `opus` are Claude
  CLI aliases — meaningless to a raw API — so they must never leak into API-mode requests.
- Steps 1–3 (explicit per-stage env, global `TRUECOURSE_MODEL`, repo `llm.stages`) keep
  working unchanged — this is the "unless we already have a mechanism" carve-out. Users
  who set a per-stage override in API mode are responsible for it being a valid model id
  for their configured provider (documented; the probe can't validate every stage).
- Unlike EE's transport (which ignores per-request model hints), the OSS
  `createApiTransport` honors `req.model ?? cfg.model` — per-stage overrides would be
  dead letters otherwise. `req.fallbackModel ?? cfg.fallbackModel` likewise.
- `resolveFallbackModel()` gains the final fallback `llm.api.fallbackModel`.
- Analyze's single-model knob needs nothing: with the transport installed it sends
  `modelFlag[1]` (usually unset) and the transport falls back to `cfg.model`.
- Because estimates call `resolveModel()`, the pre-flight estimate automatically prices
  the configured model — no estimator changes beyond pricing (next item).
- `setShowResolvedStageModel` stays `true` in OSS API mode: per-stage resolution is
  honest here (unlike EE), and the API transport will record real per-stage usage (item 7).

Landed with one refinement: honoring `req.model` is an **opt-in**, not the transport's
default. `createApiTransport(cfg, { honorRequestModel: true })` enables it, and only
`createConfiguredApiTransport()` (the OSS path) passes it — EE's calls stay bit-identical,
which matters because EE requests carry `claude -p` tier aliases (`opus`) that would
otherwise be sent to a provider API verbatim. `req.fallbackModel` follows the same opt-in.

### 6. Pricing: extend id lookup beyond Anthropic. STATUS: BUILT 2026-07-27 — `priceBySuffix()` in `model-prices.ts`

`priceForModel()` grows one step: after the exact-id and `anthropic/<id>` lookups, scan
`byId` for a key whose path suffix equals the model id (`openai/gpt-4o` ⇐ `gpt-4o`,
etc. — OpenRouter ids are `vendor/model`). Ambiguous suffix (two vendors, same model
name) → first match by vendor-alphabetical order is fine for a ceiling estimate.
Unpriceable ids keep today's behavior: stage counted, `costPartial` set, confirm prompt
still shown with token counts.

### 7. Usage accounting: the API transport records StageUsage. STATUS: BUILT 2026-07-27

`createApiTransport` calls `recordStageUsage()` after each call with the AI SDK's token
usage (input/output/cached) — something the EE transport never did (EE turns the display
off instead). `costUsd` comes from an optional `opts.pricing(modelId, usage)` hook that
core wires to the price table; absent → 0 (tokens still shown). The CLI's per-stage
` · model · tokens · $cost` tags then work identically in both modes.

Landed as `priceCall()` in `install-transport.ts`: the price table is fetched once,
asynchronously and off the hot path, because the hook is synchronous — calls before it
resolves are charged 0 rather than delayed, and any pricing error is swallowed. Input,
cache-read, and cache-write tokens are all charged at the list input rate, keeping this a
ceiling like the pre-flight estimate.

### 8. First-run wizard. STATUS: BUILT 2026-07-27 — fires on the very first command, whichever it is

Trigger: **any user-invoked `truecourse` command** — the first one the user ever runs
(`add`, `list`, `dashboard`, `analyze`, …) — when no `llm.transport` is saved AND the
session is an interactive TTY AND no explicit `--llm-transport` flag was passed (an
explicit flag skips the ask for that run without saving). Excluded: `config llm *` itself
(it IS the wizard) and `hooks run` (invoked by git hooks inside other tools, where a
prompt would break the wrapper). Non-TTY with nothing saved → claude-code, nothing
written — scripts and CI behave exactly as today.

Flow (all `@clack/prompts`, matching the estimate-confirm conventions):

```
◆ How should TrueCourse run its LLM calls?
│ ● Claude Code (recommended) — uses your existing Claude Code login, per-stage
│                               model tiers, no API key needed
│ ○ API — bring your own key (Anthropic, OpenAI, AWS Bedrock, GitHub Copilot)
```

- **Claude Code** → save `{ llm: { transport: "claude-code" } }`, continue into the
  command (LLM-consuming commands then run the existing `preflightClaudeOrExit()`).
- **API** → provider select → model text input (per-provider placeholder, required) →
  key via `p.password` (pre-noticed if the provider env var is already set: "found
  ANTHROPIC_API_KEY — press enter to use it without storing") → optional fallback model →
  optional baseURL under an "advanced" confirm → **live probe** (the ee `testConfig`
  probe, verbatim semantics: tiny call, 30s timeout, non-empty reply) → save → continue.
  Probe failure → show the provider error, offer retry/edit; never save a config that
  failed its probe (except `--no-test`, below).

The wizard body lives in `tools/cli/src/commands/config-llm-setup.ts` and is reused
verbatim by the reconfigure command.

Landed there, fired from a commander `preAction` hook in `tools/cli/src/index.ts` that
passes the invoked command path plus its `--llm-transport` value. `TRUECOURSE_LLM_TRANSPORT`
suppresses the ask alongside the flag, the bare `truecourse` (empty command path, i.e. help)
is excluded with `config llm *` and `hooks run`, and a process-level latch keeps nested
command invocations from asking twice. The probe landed in core rather than being imported
from ee — `packages/core/src/services/llm/probe.ts` (`probeApiConfig`), same semantics as
ee's `testConfig`, shared by the wizard and `config llm test`.

### 9. Reconfigure + inspection commands. STATUS: BUILT 2026-07-27 — all four shipped with the full flag surface

```
truecourse config llm setup      # re-run the wizard any time (the dashboard-Models analog)
truecourse config llm show       # extended: transport, provider, model, masked key + stage table
truecourse config llm test       # run the probe against the saved API config
truecourse config llm use <claude-code|api>   # flip the saved transport; errors if api
                                               # was never configured (points at setup)
```

`setup` accepts flags for non-interactive use (CI, dotfiles):
`--transport`, `--provider`, `--model`, `--fallback-model`, `--api-key` (discouraged —
shell history), `--api-key-env <VAR>` (stores the var *name*, resolved at run time),
`--api-key-stdin`, `--base-url`, `--region`, `--access-key-id`, `--secret-access-key`,
`--session-token`, `--header k=v` (repeatable), `--no-test` (skip probe — air-gapped).
Non-interactive without the required flags → the existing
`exitMissingNonInteractiveFlag()` pattern names them.

`show` in API mode prints the api block first (key masked `••••last4`, ee `maskKey`
convention, plus the key's source: config file / env var name), then the per-stage table
where unoverridden stages read `<api model>  api-config`.

Landed with two details worth naming: passing `--transport` is what makes `setup`
non-interactive (it never prompts, whatever the TTY says), and `show` also reports where
the *active mode* came from — `env TRUECOURSE_LLM_TRANSPORT` / `config file` /
`default — never chosen` — and marks a saved-but-inactive api block as such.

### 10. Preflight and failure modes. STATUS: BUILT 2026-07-27 — `preflightLlmOrExit()` in `tools/cli/src/lib/claude-preflight.ts`

- API mode **skips** `preflightClaudeOrExit()` entirely — no `claude` binary needed
  (CI-friendly, one of the original motivations).
- Instead: fail fast before any pipeline work when the api block is invalid or the key is
  missing (file + env both empty) with a one-liner pointing at
  `truecourse config llm setup`. No per-run network probe — the probe runs at setup/test
  time only.
- In-run provider errors surface exactly like today's transport errors (thrown, stage
  fails loudly); 429/5xx wording comes from the AI SDK error message.
- Claude-code mode is bit-for-bit today's behavior, including the auth preflight.

Landed as one entry point every LLM-spending command calls with its `--llm-transport`
value: `agent` → nothing to check; `api` (flag or saved selection) → build the transport up
front, which is the validation, and install it as the process default when the mode came
from the saved selection; anything else → the unchanged `claude` probe. `LlmApiConfigError`
is what turns an unusable config into a one-line exit instead of a stack trace.

### 11. Dashboard: consumes the config, never edits it. STATUS: BUILT 2026-07-27 — nothing LLM-related in the dashboard

The OSS dashboard server installs the configured transport (item 4) so dashboard-triggered
spec scans / guard generates / analyze / flow-enrich use the same selection as the CLI —
it simply reads the same global config the CLI writes. **No credential entry, no
transport editing, and no LLM status display appear in the OSS dashboard** — no routes,
no page, no settings line (the proposed read-only status line was reviewed and dropped).

Landed as `apps/dashboard/server/src/services/llm-transport.service.ts`:
`installLlmTransportAtBoot()` (warn-and-continue on a broken api config, so the server
still starts) after `loadEnterprise()`, and `ensureLlmTransport()` at the spec-scan,
guard-generate, analyze (LLM rules only), and flow-enrich entry points. Both are no-ops
under `isEnterprise()`. Zero client changes.

### 12. Security posture. STATUS: BUILT 2026-07-27 — plaintext `0600` config file (+ env-var-name option); keychain deferred

- Key at rest: plaintext in a `0600` file in the user's home — the `~/.aws/credentials` /
  `~/.npmrc` precedent. OS keychain integration is a possible follow-up, not v1 (three
  platforms, non-interactive access issues). EE's AES-GCM-in-Postgres model is not
  imported: encrypting a local file whose key must sit beside it adds ceremony, not
  security.
- The key never appears in: logs, `config llm show` (masked), error messages, telemetry,
  estimates, or the per-repo committable config. The wizard warns when `--api-key` is
  passed as a bare flag.
- `structuredClone`-free redaction helper in `global-config.ts` so any future "dump
  config" surface gets masking by construction.

Landed as `maskSecret()` + `redactGlobalConfig()` (which masks `apiKey`,
`secretAccessKey`, and `sessionToken`). `writeGlobalConfig()` re-`chmod`s to `0600` on
every write, since the `mode` option only applies when the file is created — a config that
was once world-readable does not stay that way.

### 13. Structured output: schema-enforced in API mode, OSS and EE. STATUS: BUILT 2026-07-27 — revised per owner review (was: keep schema-in-prompt only)

Every LLM runner passes its stage's existing Zod schema on the request —
`schema: jsonSchemaHint(<stage schema>)` — at all ~18 spec-consolidator /
contract-extractor / guard-generator call sites (analyze's transport branch already
does). Consequences:

- **API mode (OSS and EE — same promoted transport)**: `generateObject` with the schema —
  the provider enforces the shape at generation time instead of us discovering drift at
  parse time. Callers' fence-strip + Zod stay as a second line, unchanged.
- **EE gets this automatically**: the runners are shared and `createApiTransport` already
  honors `req.schema` — no EE-side work.
- **Claude-code mode: bit-for-bit unchanged.** The CLI transport ignores `req.schema`,
  and prompts keep their schema text in v1 — so stage fingerprints and the KV caches do
  not move, in either mode (cache keys hash prompt content, not the request's schema
  field).
- **No silent degradation** (revised 2026-07-29 after issue #836 — OpenAI-family strict
  output requires every property in `required` and `additionalProperties: false`, which
  the original silent JSON-mode fallback masked into empty runs): a schema on an enforced
  request MUST normalize to strict-valid or the transport **throws**
  (`SchemaNotEnforceableError`, naming the offending path). Normalization
  (`packages/llm-api/src/strict-schema.ts`) makes every key required, widens
  formerly-optional fields to accept `null` (tracking the widened paths), strips those
  injected nulls from the response before the caller's Zod sees it, and drops
  validation-inert keywords strict mode rejects (`default`, root `$schema`). Shapes
  strict mode cannot express — typed `z.record` maps, non-object roots, open `{}` — carry
  an explicit, commented `enforceSchema: false` at their call site (5 today: spec.vocab,
  contract.reconcile, contract.gapJudge, guard.recipe, guard.generate/retry) and use
  plain JSON mode; a CI gate over every real stage schema pins that list exactly.
- Follow-up (separate, deliberate): removing the now-redundant schema text from prompts
  once enforcement is primary — that moves stage fingerprints and invalidates caches, so
  it is its own change, not part of this plan. Reshaping the five opted-out schemas to
  strict-expressible forms (records → key/value arrays) belongs to the same follow-up.

## What does NOT change

- EE: Models page, encrypted Postgres store, `registerLlmProviders`, no-CLI-fallback
  rule, tracing. Only its import path for the transport core moves.
- The `agentTransport` mailbox mode and all `--io` plumbing.
- Per-repo `.truecourse/config.json` semantics (committable, `llm.stages` overrides).
- Prompts, caches, stage fingerprints. (The leaf runners gain a `schema:` field on their
  requests — item 13 — but prompt content is byte-identical.)
- Claude-code mode behavior, including tier-alias `STAGE_DEFAULTS` and auth preflight.
- The pre-flight estimate + confirm UX (API mode reuses it; only pricing lookup widens).

## Test plan

- `tests/server/` (core): global-config read/write/perms/malformed; `resolveModel` /
  `describeStageResolutions` / `resolveFallbackModel` in API mode (override precedence,
  `api-config` source); `installConfiguredLlmTransport` (mode selection, env override,
  mtime re-install, api-block validation); `priceForModel` suffix matching.
- `tests/llm-api/` (moved from `tests/ee-llm/` + kept green via the re-export):
  transport construction per provider, `req.model` override honored, fallback retry,
  StageUsage recording with the AI SDK mock model (`ai/test`), pricing hook; schema
  dispatch — strict `generateObject`, open-`{}` fallback, non-object-root fallback.
- Runner schema wiring: a capturing fake transport asserts every spec/contract/guard
  stage request carries a parseable `req.schema` matching its Zod validator, and that
  prompt strings are byte-identical to before (fingerprint guard).
- `tests/cli/`: wizard flows via the non-interactive flag surface (`setup --transport api
  --provider anthropic --model X --api-key-env FOO --no-test`), `use` flip + error path,
  `show` masking, `test` probe against a mock, non-TTY first-run = claude-code untouched,
  preflight skip in API mode.
- `tests/architecture/`: updated boundary test (only `packages/llm-api` may import
  `ai`/`@ai-sdk/*`; `ee-llm` re-export exempt under `ee/`).
- Full-suite gate: `pnpm build && pnpm test` green; no snapshot/fingerprint drift
  expected (no prompt changes).

## Implementation phases (each an Opus agent task, in order)

All six are BUILT (2026-07-27), one commit each on PR #835's branch.

1. **Package promotion.** Create `packages/llm-api`, move the four source files from
   `ee/packages/llm`, make `@truecourse/ee-llm` a re-export, update the boundary test,
   dedupe `LlmProviderKind` into shared, add the non-object-root schema guard (item 13),
   keep `tests/ee-llm/*` green.
2. **Core config + wiring.** `global-config.ts`, `install-transport.ts`, `resolveModel`
   API-mode default + `api-config` source, `resolveFallbackModel`, `resolveTransport`
   `'api'` branch, `priceForModel` suffix match, StageUsage + pricing hook in the
   transport.
3. **Runner schema wiring.** Pass `jsonSchemaHint(<stage schema>)` as `req.schema` at
   every spec-consolidator / contract-extractor / guard-generator call site — prompts
   byte-identical, fingerprint-guard test included (item 13).
4. **CLI surface.** First-run wizard, `config llm setup/show/test/use`, flag surface,
   preflight branching, `--llm-transport api`, non-TTY paths, probe reuse.
5. **Dashboard server.** Boot + lazy mtime-checked install. Nothing client-side.
6. **Docs.** README (new commands, config schema, env vars), CLAUDE.md storage section
   (global `config.json` is now real; new package in layout), `.env.example`,
   SPEC_GUARD_PLAN item 953 pointer, this doc's STATUS lines. (The README has no
   package-layout listing; `packages/llm-api` is listed in CLAUDE.md's Project Layout only.)

Phases 1–3 are independent of 4–5 only in code, not in review: land as one PR chain on a
single feature branch, each phase green on its own.

## Resolved questions (owner, 2026-07-27, PR #835)

1. **Provider scope** — all four (anthropic/openai/bedrock/copilot) ship in v1.
2. **Code promotion** — approved: `ee/packages/llm`'s transport core moves into OSS
   `packages/llm-api`; EE keeps store/UI/tracing.
3. **Dashboard** — nothing LLM-related in the dashboard at all (the read-only status
   line is dropped); the dashboard just uses the same config as the CLI.
4. **Key storage** — plaintext `0600` config file (with `--api-key-env` for the
   env-var-name option); keychain deferred.
5. **Wizard placement** — the very first `truecourse` command, no matter which one.
6. **Structured output** (added in review) — API mode must be schema-enforced in both
   OSS and EE: runners pass `req.schema`, transport uses `generateObject` (item 13).
