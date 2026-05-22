# Agentic CLI for Spec Conflict Resolution

Status: planned, not started. **Sequenced before** `PLAN_LLM_MODEL_CONFIG.md`.

## Why

The dashboard has a complete UI surface for resolving spec conflicts —
per-conflict pick/custom, revoke, mark superseded, manual-include for
skipped docs. The CLI exposes only batch operations (`spec scan`,
`spec resolve --all-defaults`, `spec apply`). An LLM-driven agent
(Claude Code, an in-house tool) has no way to:

- read open conflicts in a machine-parseable form,
- propose a per-conflict decision and write it,
- use the workstream-2/3 escape hatches (manual chain, manual
  include),
- check status between actions.

The intended workflow for an agent + human pair:

  1. Agent reads conflicts via CLI (`--json`).
  2. Agent reads per-conflict explanation + candidate metadata.
  3. Agent proposes a decision, asks the human for confirmation.
  4. Agent writes the decision via CLI.
  5. After all resolutions, agent runs `truecourse spec apply`.

Today only step 1 is partly possible (parsing scan output), and steps
3–4 aren't possible at all from the CLI.

## Goals

1. Make every UI-only action available as a CLI command.
2. Provide machine-readable (`--json`) output for read commands so an
   agent can ingest state without scraping prose.
3. Keep the human-friendly output as the default; `--json` is opt-in.
4. Use the same `spec-in-process` code path the dashboard server uses,
   so behaviour matches exactly.

## Command surface

```
# Conflicts
truecourse spec conflicts list [--json] [--decided] [--all]
truecourse spec conflicts show <id> [--json]
truecourse spec conflicts pick <id> <candidateIndex> [--note "..."]
truecourse spec conflicts custom <id> --text "..."
truecourse spec conflicts revoke <id>

# Version chains (manual supersession)
truecourse spec chains list [--json]
truecourse spec chains add --older PATH --newer PATH [--note "..."]
truecourse spec chains remove --older PATH --newer PATH

# Relevance filter overrides
truecourse spec docs skipped [--json]
truecourse spec docs include <path>
truecourse spec docs uninclude <path>
```

### Read commands — `--json` output

When `--json` is set, the command emits a single JSON document on
stdout and nothing else (no `clack`/spinner noise). The agent parses
it and proceeds.

Example shapes:

`spec conflicts list --json`:

```json
{
  "scannedAt": "2026-05-22T...",
  "counts": { "open": 5, "decided": 0, "resolved": 189, "claimsExtracted": 283 },
  "openConflicts": [
    {
      "id": "c-...",
      "topic": "auth",
      "subject": "auth scheme",
      "explanation": "v1 PRD says no auth; v2 PRD says Bearer JWT with /health exempt; Auth0 docs describe the JWT infra.",
      "defaultPick": 3,
      "candidates": [
        {
          "index": 0,
          "weight": "oldest",
          "file": "docs/PRDs/PRD_DATA_COMPLIANCE_V1.md",
          "line": 270,
          "docKind": "prd",
          "status": "shipped",
          "kind": "definition",
          "lastTouched": "2026-03-25T...",
          "content": { "scheme": "none", "scope": "global" }
        },
        ...
      ],
      "candidateFingerprint": "..."
    }
  ]
}
```

`spec conflicts show <id> --json` — same shape but a single conflict
including its quote/preview text fully.

`spec chains list --json`:

```json
{
  "auto": [
    { "id": "...", "detectedFrom": "filename", "docs": ["docs/PRDs/foo_v1.md", "docs/PRDs/foo_v2.md"] }
  ],
  "manual": [
    { "older": "docs/PRDs/A.md", "newer": "docs/PRDs/B.md", "markedAt": "...", "note": "..." }
  ]
}
```

`spec docs skipped --json`:

```json
{
  "skipped": [
    { "path": "tasks/release-notes-draft.md", "reason": "..." },
    ...
  ],
  "manualIncludes": [ "scripts/ralph/research/US-001.md" ]
}
```

### Write commands

Each write commits to `decisions.json` and re-runs the scan so the
next read reflects the change. Emits a one-line confirmation by
default; `--json` emits a structured `{ ok: true, ... }` for the
agent.

Validation: write commands fail loudly when arguments don't match the
current state (e.g., `pick` with an out-of-range index, `chains
remove` with a chain that doesn't exist).

### Help

Every command surfaces help via `--help` with the conventional
`commander` formatting. Help text mentions `--json` and links to this
plan.

## Implementation

### New files

- `tools/cli/src/commands/spec-conflicts.ts` — `list / show / pick /
  custom / revoke` subcommands.
- `tools/cli/src/commands/spec-chains.ts` — `list / add / remove`
  subcommands.
- `tools/cli/src/commands/spec-docs.ts` — `skipped / include /
  uninclude` subcommands.

Each file is a thin shim over `@truecourse/core/commands/spec-in-process`.

### Shared helpers in `@truecourse/core`

- `readScanResult(repoRoot)` — load scan-state.json (after running
  scan if absent); the per-conflict commands need both the conflicts
  and the candidate fingerprint to write a decision.
- `applyDecision(repoRoot, conflictId, resolution)` — same write
  logic the server endpoint uses; extract into core so both the
  dashboard server and CLI call it.
- `applyManualChain` / `removeManualChain` — already in
  spec-consolidator; expose via core for both surfaces.
- `applyManualInclude` / `removeManualInclude` — same.

### Output

- Default: human-friendly clack output (intro/outro, step icons).
- `--json`: clack output suppressed; only the structured payload
  emitted on stdout.

### Index command registration

Wire all three new command groups into `tools/cli/src/index.ts`
under the existing `spec` parent command:

```ts
program
  .command('spec')
  .description('...')
  .command('conflicts').description('...').addCommand(...).addCommand(...)
  .command('chains').description('...').addCommand(...).addCommand(...)
  .command('docs').description('...').addCommand(...).addCommand(...);
```

## Tests

- Per-command snapshot tests on the JSON output shape (so agents can
  rely on it not silently drifting).
- Round-trip: `pick → conflicts list --json` shows the chosen
  candidate as decided.
- `chains add → conflicts list --json` shows the cascading
  conflicts cleared.
- `docs include → docs skipped --json` shows the include reflected
  in `manualIncludes`.

## Migration

Non-breaking. Existing `spec scan`, `spec resolve --all-defaults`,
`spec apply` keep working. New surface is purely additive.

## Out of scope

- Agent prompts / system message templates for Claude Code itself.
  This plan provides the CLI substrate; the agent integration is a
  separate concern that lives in the consumer's prompt library.
- Tab-completion for `<id>` arguments. Conflict ids are sha256
  hashes; the human paste flow is "agent prints it, user pastes
  back." Completion isn't worth the implementation cost.
- WebSocket / streaming output for long-running operations. Existing
  `spec apply` already prints clack progress; CLI users don't need
  the dashboard's socket stream.

## Estimated effort

- New CLI command modules: ~150 LOC
- Shared core helpers (extracted from server routes): ~80 LOC
- Tests: ~100 LOC
- Total: ~half a day of focused work

## Success criteria

After implementation, an agent should be able to drive a full
resolution session end-to-end with these commands alone:

  1. `truecourse spec conflicts list --json` → understand the
     landscape
  2. For each conflict: read explanation, propose, ask user
  3. `truecourse spec conflicts pick <id> <i>` / `chains add` /
     `docs include` based on the decision
  4. `truecourse spec apply`

No dashboard required. The dashboard remains the better UX for
humans; the CLI becomes a first-class peer for agent-assisted
workflows.
