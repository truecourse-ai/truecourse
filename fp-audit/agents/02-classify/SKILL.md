---
name: fp-audit-02-classify
description: Slice an audit's violations by (rule, shape) and dispatch parallel classifier sub-agents to label each as TP, FP, DRIFT, or UNCERTAIN. Merges results into the global fp.jsonl. Input is the audit dir produced by agent 01.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-pipeline/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- `audit_dir` (required) — path printed by agent 01, e.g. `fp-audit/state/targets/documenso-a1b2c3d/`

# Outputs

- `<audit_dir>/slices/slice-NNNN.jsonl` — deterministic per-shape input (one violation per line)
- `<audit_dir>/slices/manifest.json` — list of slices with their `(rule, shape_sig, count)`
- `<audit_dir>/reports/slice-NNNN.jsonl` — classifier output (one row per input violation)
- `fp-audit/state/fp.jsonl` — merged global ledger; new rows appended for entries classified `FP`

# Steps

1. Read `<audit_dir>/state.json` to get `repo`, `target_commit_sha`, `clone_path`. Pick the **latest** snapshot in `<audit_dir>/snapshots/` (alphabetical sort works because filenames are ISO-8601 prefixed).

2. Slice the snapshot deterministically:
   ```bash
   node fp-audit/agents/02-classify/slice.mjs \
     <audit_dir>/snapshots/<latest>.json \
     <clone_path> \
     <audit_dir>/slices
   ```
   This is pure and idempotent — running it twice on the same inputs writes the same files.

3. **Pre-dispatch report (always print, before any sub-agent is dispatched).** Read `<audit_dir>/slices/manifest.json` and print a single block to stdout:

   ```
   ── stage 2 dispatch plan ────────────────────────────────
   total slices:    <N>
     head:          <H>   (1 sub-agent each, classifies the shape once)
     tail:          <T>   (1 sub-agent each, classifies each row)
   total violations covered: <total of `count` across manifest>
   total sub-agents: <N>             (one per slice)
   wave size:        30
   estimated waves:  <ceil(N / 30)>
   estimated wall time: ~<ceil(N / 30) * 60>s if waves average 1 min
   ```

   Counts come from the `kind` field in the manifest. This block is the user's checkpoint — it shows up before any classifier work begins so they see the cost up front. Do NOT skip it.

4. **Wave-based dispatch loop. Do not exit this loop until every slice has a non-empty, valid report file.** This is a hard gate; partial coverage is not acceptable.

   Pseudocode (treat literally — implement this loop in your reasoning):
   ```
   WAVE_SIZE = 30          # sub-agents dispatched in parallel per wave
   MAX_WAVE_RETRIES = 2    # per-slice retries before declaring it stuck

   manifest     = load <audit_dir>/slices/manifest.json
   retry_count  = {} per slice, default 0

   # Token accounting. Every Agent tool call returns usage in its response;
   # accumulate per wave so the user sees cost in real time.
   tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0, sub_agents: 0 }

   loop:
     pending = [m for m in manifest
                if NOT exists(<audit_dir>/reports/<m.slice>) OR empty(<audit_dir>/reports/<m.slice>)]
     if pending is empty: break loop  # every slice has a report — exit

     batch = first WAVE_SIZE entries of pending
     for each m in batch:
       if retry_count[m.slice] >= MAX_WAVE_RETRIES:
         continue   # leave pending; we will fail-hard at the gate below
       retry_count[m.slice] += 1

     # Dispatch every slice in `batch` IN A SINGLE MESSAGE using the Agent tool
     # (subagent_type=general-purpose, model="sonnet"). Classification is
     # moderate-difficulty pattern-matching work — Sonnet handles it for ~5×
     # less cost than Opus. Always pass model="sonnet" on every dispatch.
     # For each slice m, pick the prompt template by m.kind:
     #   m.kind == "head" → head template (1 classification for the whole shape)
     #   m.kind == "tail" → tail template (1 classification per row)
     # Substitute {{slice_path}}, {{report_path}}, {{clone_path}} as usual.
     # Wait for ALL sub-agents in this wave to return.

     # Token accounting. Each Agent tool result includes a usage block. For
     # every sub-agent that returned in this wave, add to `tokens`:
     #   tokens.input       += usage.input_tokens or 0
     #   tokens.output      += usage.output_tokens or 0
     #   tokens.cache_read  += usage.cache_read_input_tokens or 0
     #   tokens.cache_write += usage.cache_creation_input_tokens or 0
     #   tokens.sub_agents  += 1

     # Validate freshly-written reports. For each m in batch:
     #   - report file must exist and be non-empty
     #   - if m.kind == "head": report MUST have exactly 1 row
     #   - if m.kind == "tail": report MUST have exactly m.count rows
     #   - if invalid: delete the report so the loop redispatches next iteration

     # Progress update — print ONE line after each wave completes:
     #   wave N/<total>: <ok>/<batch_size> ok, <bad> redispatching · cumulative <done>/<total> · remaining <pending_after> · tokens in/out/cache <I>/<O>/<C> (~$<cost>)
     # where:
     #   N             = wave number (1-indexed)
     #   <total>       = total waves estimated up front (ceil(total_slices / WAVE_SIZE))
     #   <ok>          = slices in this batch that passed validation
     #   <bad>         = slices in this batch whose reports were deleted (will retry)
     #   <done>        = total slices with valid reports across the whole stage
     #   <pending_after> = total slices still without valid reports (= total_slices - done)
     #   <I>,<O>,<C>   = cumulative tokens.input, tokens.output, tokens.cache_read (humanize: 1.2K, 3.4M)
     #   <cost>        = estimated cost in USD using Sonnet pricing:
     #                   cost = (input * 3 + output * 15 + cache_read * 0.30 + cache_write * 3.75) / 1_000_000
   end loop

   # Hard gate. If any slice still lacks a valid report after retries:
   stuck = [m for m in manifest if report invalid per the rules above]
   if stuck is not empty:
     log to fp-audit/state/decisions.jsonl:
       { stage: 2, situation: "slices stuck without valid report", chose: "ABORT", unit: <slice names> }
     ABORT stage 2 — do not proceed to step 6 (merge). Fail loud, name the stuck slices.
   ```

   The loop is the only correct way to handle volume. Do **not** truncate the slice list. Do **not** sample. Do **not** skip slices to make wall time shorter.

5. The loop in step 4 enforces "every slice has exactly one valid report". Move to step 6 only after that gate passes.

6. Merge reports into `fp-audit/state/fp.jsonl`. The merge branches on `kind`:

   For each manifest entry `m`:
   - Read `<audit_dir>/slices/<m.slice>` — these are the violation rows that this slice covers.
   - Read `<audit_dir>/reports/<m.slice>` — the classifier's output.
   - **If `m.kind == "head"`**: the report has 1 row with `{class, why, skip_hint}` (the shape's verdict). Emit one `fp.jsonl` entry per row in the slice, **all sharing** that single `class`/`why`/`skip_hint`.
   - **If `m.kind == "tail"`**: the report has N rows, one per slice row, in the same order. Zip slice rows with report rows by index; each pair → one `fp.jsonl` entry with that pair's `class`/`why`/`skip_hint`.

   For every emitted entry, build:
   ```json
   {
     "id": "<sha1(repo + ":" + file + ":" + line + ":" + rule).slice(0,16)>",
     "repo": "<repo>",
     "target_commit": "<full sha>",
     "file": "<file>",
     "line": <line>,
     "rule": "<rule>",
     "shape_sig": "<shape_sig>",
     "class": "TP|FP|DRIFT|UNCERTAIN",
     "status": "unconfirmed",
     "why": "<short reason — same for all rows in a head slice; per-row in tail>",
     "classifier_model": "<model id used by the sub-agent>",
     "classified_at": "<iso>",
     "positive_fixture_path": null,
     "negative_fixture_path": null,
     "fixed_by_commit": null
   }
   ```

   Read `fp-audit/state/fp.jsonl` if it exists. Index existing rows by `id`. Upsert: update `class`, `why`, `classifier_model`, `classified_at`, `shape_sig`; preserve `status`, `positive_fixture_path`, `negative_fixture_path`, `fixed_by_commit` (those are owned by later agents). Sort the merged list by `(repo, file, line, rule)` and write atomically (`fp.jsonl.tmp` → rename).

7. Persist token usage and print the final summary.

   Write `<audit_dir>/usage.json` with the cumulative `tokens` object plus the cost computation:
   ```json
   {
     "stage": 2,
     "model": "sonnet",
     "sub_agents": <tokens.sub_agents>,
     "input_tokens": <tokens.input>,
     "output_tokens": <tokens.output>,
     "cache_read_tokens": <tokens.cache_read>,
     "cache_write_tokens": <tokens.cache_write>,
     "estimated_cost_usd": <(input * 3 + output * 15 + cache_read * 0.30 + cache_write * 3.75) / 1_000_000>,
     "completed_at": "<iso UTC>"
   }
   ```
   If a previous `usage.json` exists for the same audit (resumed run), sum the new totals into it (do not overwrite — accumulate).

   Print to stdout:
   ```
   <audit_dir>: classified <N> rows — <TP_count> TP, <FP_count> FP, <DRIFT_count> DRIFT, <UNCERTAIN_count> UNCERTAIN
   tokens: <I> in / <O> out / <C> cache-read / <W> cache-write across <S> sub-agents
   estimated cost: ~$<cost> (Sonnet pricing: $3/Mtok in, $15/Mtok out, $0.30/Mtok cache-read, $3.75/Mtok cache-write)
   ```

   Cost formula uses Sonnet 4.6 pricing constants. If you switch the classifier model later, update the constants both here and in the wave-progress line.

# Sub-agent prompt templates

There are two templates. Pick by the slice's `kind` in the manifest. Substitute `{{slice_path}}`, `{{report_path}}`, `{{clone_path}}` in either case.

## Head template (kind == "head")

All rows in a head slice share the same `(rule, shape_sig)` — i.e., the same AST shape with different identifiers/literals. The classifier decides ONCE for the shape and the merge step stamps every row with that label.

````
You are classifying ONE static-analysis shape (rule + AST pattern) shared
by every row in this slice. Make ONE classification for the whole shape.

Input file: {{slice_path}}
  - JSONL, one violation per line.
  - Schema: { repo, target_commit, file, line, rule, shape_sig, snippet, title }
  - All rows have the same `rule` and `shape_sig` — they are instances of the
    same code pattern with different identifiers/strings/numbers.

Source repo root: {{clone_path}}
  - Use Read to open files referenced in the slice (paths are relative to this root).
  - Pick 2-3 representative rows from the slice. Read each row's file at the
    given line, ±20 lines of context. Confirm they really do exhibit the same
    pattern (sanity check the slicer).

Your job: decide ONE class for this shape:

  - TP        — the rule legitimately fires on this pattern.
  - FP        — the pattern is benign; the rule misfires here. Explain the
                false premise (e.g., "the variable is unused but explicitly
                prefixed with `_` to opt out").
  - DRIFT     — the rule once made sense but the codebase has moved on.
  - UNCERTAIN — you cannot decide from the code alone.

Output: write JSONL to {{report_path}} with EXACTLY ONE LINE.
Schema:
  { rule, shape_sig, class, why, skip_hint }

Where:
  - `class`     : TP | FP | DRIFT | UNCERTAIN
  - `why`       : <= 200 chars, the single most load-bearing reason
  - `skip_hint` : optional, FP only — what predicate the rule's visitor
                  should add to suppress this shape (e.g., "skip when
                  identifier starts with `_`"). Null otherwise.

Constraints:
  - Output ONLY the JSONL file with exactly 1 line.
  - Do not edit any source files. Do not modify the slice file.
  - NEVER ask the user a question. If genuinely unanalyzable, classify as
    UNCERTAIN with a one-line `why` and write the row.
````

## Tail template (kind == "tail")

A tail slice is heterogeneous — rows share only the `rule`, not the shape. Each row needs its own decision.

````
You are classifying static-analysis violations for ONE rule. The rows in this
slice share the rule but have DIFFERENT AST shapes (the slice contains the
"long tail" of rare shapes for this rule). Classify EACH row independently.

Input file: {{slice_path}}
  - JSONL, one violation per line.
  - Schema: { repo, target_commit, file, line, rule, shape_sig, snippet, title }
  - All rows have the same `rule`. `shape_sig` varies.

Source repo root: {{clone_path}}
  - Use Read to inspect any file referenced in the slice (paths relative to root).

Your job: for EACH input row, decide:

  - TP        — the rule legitimately fires on this code.
  - FP        — the code is benign; the rule misfires here. Explain the false
                premise.
  - DRIFT     — the rule once made sense but the codebase has moved on.
  - UNCERTAIN — you cannot decide from the surrounding code alone.

Read the file at `file:line` and inspect ±20 lines of context before deciding.
You may read sibling files if a definition is needed.

Output: write JSONL to {{report_path}}, one row per input row, IN THE SAME ORDER.
Schema:
  { file, line, rule, shape_sig, class, why, skip_hint }

Where:
  - `class`     : TP | FP | DRIFT | UNCERTAIN
  - `why`       : <= 200 chars
  - `skip_hint` : optional, FP only

Constraints:
  - Output ONLY the JSONL file.
  - Do not edit source files. Do not modify the slice file.
  - If the slice has N rows, the report MUST have N rows in the same order.
  - NEVER ask the user a question. If a row is unanalyzable, classify
    UNCERTAIN with a one-line `why` and continue.
````

# Resumability

The loop in step 3 is naturally resumable. If a previous run was interrupted, re-invoke the SKILL with the same `audit_dir`: the loop sees existing valid reports in `<audit_dir>/reports/` and skips them, only redispatching the gaps.

To force re-classification (e.g., after a model upgrade): delete the relevant report files (or the whole `reports/` dir) before invoking. The loop will rebuild them.

# Failure modes

- A wave's sub-agent produces a report whose row count ≠ its slice's row count → the loop deletes that bad report so the next iteration redispatches. After `MAX_WAVE_RETRIES`, the slice is declared stuck and the stage aborts.
- A sub-agent crashes / produces no file → loop sees missing report, redispatches next wave.
- `fp.jsonl` exists but is malformed → abort the merge step (step 5). Do not overwrite. Surface the parse error.
- Stage is **never** allowed to advance to the merge step with partial coverage. The hard gate at the end of step 3 is the only acceptable exit.
