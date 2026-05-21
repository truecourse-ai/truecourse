# LLM Model Config — Standardize per-stage model selection

Status: planned, not started.

## Why

Today every LLM call shells out to `claude -p` with no `--model` flag, so
the CLI default (currently Opus 4.7) is used for everything. That's the
most expensive option for stages that don't need it. We want per-stage
model selection so:

- Easy stages (version-chain detection) run on Haiku
- Medium stages (claim extraction, section rendering) run on Sonnet
- Hardest stages (contract extraction, contract repair) keep Opus

Rough cost picture for a ~30-doc project:

| Setup | Cost / regen |
|---|---|
| All Opus (today) | ~$5–10 |
| Sonnet for medium, Opus for hardest | ~$1.50–2.50 |
| Haiku for easy + Sonnet for medium + Opus for hardest | ~$0.50–1.00 |

## Stage catalog

| Stage ID | File | Difficulty | Default model |
|---|---|---|---|
| `spec.chainDetect` | `packages/spec-consolidator/src/version-chain-llm.ts` | easy | `haiku` |
| `spec.claimExtract` | `packages/spec-consolidator/src/extractor.ts` (runner) | medium | `sonnet` |
| `spec.sectionRender` | `packages/spec-consolidator/src/section-runner.ts` | medium | `sonnet` |
| `contract.extract` | `packages/contract-extractor/src/claude-runner.ts` | hardest | `opus` |
| `contract.repair` | `packages/contract-extractor/src/repair.ts` | hard | `opus` |
| `rules.violationGen` | `packages/core/src/services/llm/cli-provider.ts` | varies | (existing config) |

Stage IDs are stable strings — renaming a file doesn't change the ID.

## Config schema (.truecourse/config.json)

Add a new top-level `llm` block:

```json
{
  "llm": {
    "stages": {
      "spec.chainDetect":   "haiku",
      "spec.claimExtract":  "sonnet",
      "spec.sectionRender": "sonnet",
      "contract.extract":   "opus",
      "contract.repair":    "opus",
      "rules.violationGen": "opus"
    },
    "fallbackModel": "sonnet",
    "maxConcurrency": 4
  }
}
```

The file stays **empty by default** (`{}`); the `llm` block is optional.
Runners hold the defaults in code; config is override-only.

`ensureRepoTruecourseDir` writes an empty `config.json` when the file
doesn't exist — so every entry point that touches `.truecourse/` (`add`,
`scan`, `apply`, `analyze`, `contracts generate`) guarantees the file
exists with consistent default content.

## Env vars

Naming convention: `TRUECOURSE_MODEL_<STAGE_ID_UPPER_WITH_UNDERSCORES>`.
Stage IDs convert mechanically: `spec.chainDetect` →
`TRUECOURSE_MODEL_SPEC_CHAIN_DETECT`.

- `TRUECOURSE_MODEL_SPEC_CHAIN_DETECT`
- `TRUECOURSE_MODEL_SPEC_CLAIM_EXTRACT`
- `TRUECOURSE_MODEL_SPEC_SECTION_RENDER`
- `TRUECOURSE_MODEL_CONTRACT_EXTRACT`
- `TRUECOURSE_MODEL_CONTRACT_REPAIR`
- `TRUECOURSE_MODEL_RULES_VIOLATION_GEN`
- `TRUECOURSE_MODEL` — global override (every stage)
- `TRUECOURSE_FALLBACK_MODEL` — global fallback

Legacy `CLAUDE_CODE_MODEL` becomes a deprecated alias for
`TRUECOURSE_MODEL` with a one-line deprecation log on first read.

## Precedence

Highest to lowest:

```
CLI flag (--model)
  >  TRUECOURSE_MODEL_<STAGE>   (per-stage env)
  >  TRUECOURSE_MODEL           (global env)
  >  config.json llm.stages.<stage>
  >  config.json llm.defaultModel (if we add it later)
  >  in-code stage default
```

Fallback model resolves the same way (per-stage env > global env > config
> in-code).

## Shared runner

Currently each stage has its own subprocess spawn + JSON parse +
schema validation logic. Consolidate into one helper:

```ts
// packages/core/src/services/llm/cli-runner.ts
export interface CliRunnerOptions<TOutput> {
  stageId: string;
  systemPrompt: string;
  userPrompt: string;
  schema?: ZodSchema<TOutput>;
  timeoutMs?: number;
  cacheKey?: string;
}
export async function runCli<TOutput>(opts: CliRunnerOptions<TOutput>): Promise<TOutput>;
```

Internally:

1. Resolve `model = resolveModel(stageId)` via the precedence chain above
2. Spawn `claude -p --model <model> --output-format json
   --append-system-prompt <prompt> --setting-sources project` with the prompt
3. Parse JSON envelope → `result` field
4. Strip code fences (some models wrap JSON despite instructions)
5. Validate against `schema` if provided
6. On `overloaded` error from Anthropic, retry once with `fallbackModel`
7. Emit a standardized `LlmCallEvent` for telemetry / progress UI

## Telemetry standardization

One event shape across all stages:

```ts
interface LlmCallEvent {
  stageId: string;
  model: string;
  status: 'started' | 'completed' | 'failed' | 'cache-hit' | 'fallback-used';
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheKey?: string;
  error?: string;
}
```

CLI step renderer, dashboard sockets, and `analysis.usage[]` snapshot all
consume this one shape. No per-stage event handlers.

## Cache standardization

Every cache key includes:

- `stageId` (so changing one stage's prompt doesn't invalidate another's)
- `modelName` (so switching models invalidates appropriately)
- `promptFingerprint` (so prompt changes invalidate)
- `inputFingerprint` (slice text / doc preview / whatever the stage consumed)

```ts
function cacheKey(parts: {
  stageId: string;
  modelName: string;
  promptFingerprint: string;
  inputFingerprint: string;
}): string;
```

## File renames for consistency

| Current | Renamed |
|---|---|
| `packages/contract-extractor/src/claude-runner.ts` | `contract-extract.runner.ts` |
| `packages/spec-consolidator/src/runner.ts` (block extractor) | `claim-extract.runner.ts` |
| `packages/spec-consolidator/src/section-runner.ts` | `section-render.runner.ts` |
| `packages/spec-consolidator/src/version-chain-llm.ts` runner part | `chain-detect.runner.ts` |
| `packages/contract-extractor/src/repair.ts` runner part | `contract-repair.runner.ts` |
| `packages/core/src/services/llm/cli-provider.ts` | `violation-gen.runner.ts` |

Each file exports a thin `run(input): Promise<output>` that wraps
`runCli` with its stage-specific prompt + schema. No more bespoke
subprocess plumbing per file.

## CLI surface

New subcommand for visibility:

```
truecourse config llm                    # show resolved model per stage
truecourse config llm --init             # scaffold the full llm block in config.json
truecourse config llm --set <stage> <model>   # write one override
truecourse config llm --unset <stage>    # remove one override
```

`--show` is the most important: it prints the **effective** model per
stage (resolving precedence chain), so a user can verify what's actually
being used without reading code.

## Migration plan

1. **Add config schema + resolver** in `packages/core/src/config/llm-models.ts` (new file).
   - Schema validation (Zod) for the `llm` block
   - `resolveModel(stageId): string` reads precedence chain
   - Tests for precedence resolution
2. **Build `runCli` helper** in `packages/core/src/services/llm/cli-runner.ts`.
   - Standardized spawn + parse + validate + telemetry
   - Unit tests with a stub spawn
3. **Add `ensureRepoConfigFile`** in `packages/core/src/config/paths.ts`.
   - One line: write `{}` if missing
   - Called from `ensureRepoTruecourseDir`
4. **Migrate runners one at a time.** Each PR:
   - Converts one runner to use `runCli`
   - Renames the file
   - Updates the cache key format
   - Re-runs the fixture's `verify-end-to-end.test.ts` to confirm no regression
5. **Add `truecourse config llm` subcommand** (CLI surface).
6. **Document stage IDs** in this file + `docs/contracts/PLAN.md`.
7. **Deprecate `CLAUDE_CODE_MODEL`** — keep as alias of `TRUECOURSE_MODEL`,
   log a one-time deprecation notice.

## Estimated effort

- Code added: ~300–400 LOC (config schema, resolver, runCli, CLI subcommand, tests)
- Code deleted: ~400–500 LOC (per-runner duplicated subprocess plumbing)
- Net change: small reduction in LOC; large reduction in surface area
- Calendar time: ~1 focused day for the core + migration, +half day for the CLI subcommand and docs

## Out of scope

- Cost reporting / budget caps. We collect `tokensIn/Out` in the
  telemetry event; aggregating into a "per-run cost" dashboard widget
  is a separate feature.
- Provider abstraction (OpenAI / Bedrock). Today we shell to `claude`;
  if we ever add a non-Claude provider, `runCli` would become a
  dispatcher. Don't design for it now.
- Per-call retries beyond the single fallback. If Anthropic returns
  overloaded on the fallback too, fail loudly so the user can retry.
