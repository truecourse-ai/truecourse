---
name: fp-audit-02b-synthesize
description: Cluster the classifier's `why` strings into 1-5 distinct failure modes per rule. Output is rule-briefs.json — the diagnosis input for stages 3, 4, 5. Runs after stage 2 (classify), before stage 3 (positive fixtures). Reads every `why` (no sampling), map-reduce across chunks.
---

# Autonomous mode

Never ask the user questions. Never pause for confirmation. If a step fails or an input is ambiguous, follow the decision policy in `fp-audit/agents/00-fix/SKILL.md` (log to `fp-audit/state/decisions.jsonl`, continue per the table). Forbidden: "Should I proceed?", "Please clarify", any phrasing that waits for the user.

# Inputs

- (none — reads `fp-audit/state/fp.jsonl`)

# Outputs

- `fp-audit/state/synthesis/<rule_safe>/chunk-NN.json` — per-chunk input to a sub-agent
- `fp-audit/state/synthesis/<rule_safe>/chunk-NN.modes.json` — per-chunk sub-agent output (candidate modes from this chunk)
- `fp-audit/state/synthesis/<rule_safe>/brief.json` — final per-rule brief (modes merged across chunks)
- `fp-audit/state/rule-briefs.json` — array of all per-rule briefs, used by stages 3/4/5
- `fp-audit/state/fp.jsonl` — every FP row gets a `mode` field added, pointing to the mode name from the rule's brief

# Steps

1. **Run the deterministic dedup helper** to produce per-rule chunk files:

   ```bash
   node fp-audit/agents/02b-synthesize/dedup.mjs \
     fp-audit/state/fp.jsonl \
     fp-audit/state/synthesis \
     --max-chunk-rows=4000 --min-fps=10
   ```

   Output: `fp-audit/state/synthesis/<rule_safe>/chunk-NN.json` plus `index.json` listing all rules covered.

2. **Pre-dispatch plan.** Read `fp-audit/state/synthesis/index.json` and print one block to stdout before dispatching anything:

   ```
   ── stage 2.5 synthesis plan ─────────────────────────────
   rules with FPs (≥ min-fps):  <N>
   total chunks to classify:    <C>
   rules needing reduce step:   <R>   (rules with > 1 chunk)
   total sub-agent calls:       <C + R>
   wave size:                   30
   estimated waves:             <ceil((C+R) / 30)>
   ```

3. **Chunk-pass wave loop.** Dispatch one sub-agent per chunk file using the **chunk template** below. Same wave structure as stage 2: pseudocode below. Sonnet, parallel.

   ```
   WAVE_SIZE = 30
   MAX_WAVE_RETRIES = 2

   tasks = [chunk paths from every rule] (one task per chunk-NN.json file)
   retry_count = {} per task, default 0

   loop:
     pending = [t for t in tasks
                if NOT exists(<rule_dir>/<t.basename>.modes.json) OR empty(...)]
     if pending is empty: break

     batch = first WAVE_SIZE entries of pending
     for each t in batch:
       if retry_count[t] >= MAX_WAVE_RETRIES: continue
       retry_count[t] += 1

     # Dispatch every task in `batch` IN A SINGLE MESSAGE, Agent tool,
     # subagent_type=general-purpose, model="sonnet".
     # Use the chunk template below.
     # Wait for ALL sub-agents in this wave.

     # Validate each sub-agent's output:
     #   - report file <chunk-NN.modes.json> must exist + non-empty
     #   - parses as JSON
     #   - has key "modes" with 1-7 entries
     #   - each mode has: name, summary, count_in_chunk, representative_fp_ids, suggested_predicate
     #   if invalid: delete the file so the loop redispatches

     # Print per-wave progress (same format as stage 2):
     # wave N/<total>: <ok>/<batch> ok, <bad> redispatching · cumulative <done>/<total>
   end loop

   # Hard gate
   stuck = [t for t in tasks if no valid output]
   if stuck:
     log decisions.jsonl { stage: "2.5", chose: "ABORT", unit: stuck }
     ABORT stage 2.5 — do not proceed to reduce.
   ```

4. **Reduce step.** For each rule that has more than one chunk (multi-chunk rules — `unsafe-any-usage` typically), dispatch one **reduce sub-agent** that merges all `chunk-NN.modes.json` files for that rule into a single `brief.json`. Use the **reduce template** below.

   For single-chunk rules: the chunk's modes ARE the brief. Just rename/copy `chunk-00.modes.json` → `brief.json` (or symlink). No LLM call.

5. **Assemble the global rule-briefs file.** Concatenate every `<rule_safe>/brief.json` into `fp-audit/state/rule-briefs.json`:

   ```json
   [
     {
       "rule": "code-quality/deterministic/unsafe-any-usage",
       "rule_safe": "code-quality_deterministic_unsafe-any-usage",
       "total_fps": 44307,
       "total_unique_whys": 32587,
       "modes": [
         {
           "name": "library-boundary",
           "summary": "...",
           "count_in_sample": 18234,
           "representative_fp_ids": ["...", "...", "..."],
           "suggested_predicate": "..."
         },
         ...
       ]
     },
     ...
   ]
   ```

6. **Stamp fp.jsonl with mode field.** For each FP row in fp.jsonl, look up which mode it belongs to:
   - Find the row's rule's brief in rule-briefs.json
   - For each mode, the `representative_fp_ids` lists a sample. To cover ALL fp_ids (not just representatives), each chunk's mode output also includes a `member_fp_ids` field — every fp_id that the chunk sub-agent assigned to this mode. Use that for stamping.
   - Set `row.mode = mode.name`. If no mode matches (rare — should not happen because the chunk sub-agent assigns every input row to a mode), set `row.mode = "unclassified"` and log to decisions.jsonl.
   - Atomic-write fp.jsonl (tmp + rename).

7. **Print final summary:**

   ```
   ═══ synthesis complete ══════════════════════════════════
   rules synthesized:  <N>
   modes total:        <M>  (sum across all rules)
   rule-briefs.json:   fp-audit/state/rule-briefs.json
   fp.jsonl rows stamped with mode: <stamped>/<total>
   ```

# Chunk sub-agent prompt template

Substitute `{{chunk_path}}`, `{{rule}}`, `{{output_path}}`.

````
You are grouping the false-positive explanations in one chunk into 1-5
distinct failure modes for the rule `{{rule}}`.

A "mode" is a kind of false positive distinguished by what makes the rule
wrong in that case. Different modes need different visitor predicates.

Input file: {{chunk_path}}
  JSON with schema:
    {
      rule, chunk_index, total_chunks, total_fps, total_unique,
      rows: [{ why, count, fp_ids: [...] }, ...]
    }
  Each row is a UNIQUE `why` string (deterministically deduplicated by the
  orchestrator). `count` is how many FP instances share that exact why.
  `fp_ids` is the full list of fp_ids that share it.

Steps:
1. Read every row's `why`. Use semantic similarity, not surface word matching.
   "library boundary" and "third-party API return type" describe the same mode.
2. Group rows into 1-5 modes ordered by total instance count (sum of `count`).
3. Assign EVERY row to exactly one mode.

Per mode, output:
  - name              short slug, e.g. "library-boundary"
  - summary           one sentence (≤140 chars) describing the shared pattern
  - count_in_chunk    sum of `count` across the rows assigned to this mode
  - representative_fp_ids   3-5 fp_ids exemplifying the mode (pick from
                            the rows assigned)
  - member_fp_ids     full list of fp_ids assigned to this mode (concatenation
                      of `fp_ids` from every row assigned). REQUIRED for the
                      orchestrator to stamp fp.jsonl.
  - suggested_predicate
        Concrete visitor predicate. Reference AST properties or path patterns,
        not English generalities. Examples of GOOD predicates:
          "Skip when the type's symbol resolves to a declaration file under
           node_modules."
          "Skip when filePath matches `*.test.ts`, `*.spec.ts`, or contains
           `/__tests__/`."

Output: write JSON to {{output_path}}:
  {
    "rule": "{{rule}}",
    "chunk_index": <int>,
    "modes": [ ... as above ... ]
  }

Constraints:
  - Output ONLY the JSON file.
  - EVERY row in the input must be assigned to exactly one mode. The union of
    `member_fp_ids` across modes must equal the union of `fp_ids` across input rows.
  - NEVER ask the user a question. If a row is genuinely ambiguous, put it in
    the closest mode and note the ambiguity in the mode's `summary`.
````

# Reduce sub-agent prompt template

Substitute `{{rule}}`, `{{chunk_modes_paths}}`, `{{output_path}}`.

````
You are merging mode candidates from multiple chunks of the rule `{{rule}}`
into a single set of 1-5 final modes for the rule.

Each chunk independently identified modes. Different chunks may have used
different slugs for the same underlying mode. Your job is to merge.

Input: {{chunk_modes_paths}}
  A list of paths. Each file has the schema from the chunk sub-agent:
    { rule, chunk_index, modes: [{ name, summary, count_in_chunk,
      representative_fp_ids, member_fp_ids, suggested_predicate }] }

Steps:
1. Read every chunk's modes.
2. Group modes from different chunks that describe the SAME failure mode.
   Use semantic similarity. Slug names may differ; descriptions may differ
   in wording; the underlying pattern is what matches.
3. Merge each group into one final mode:
   - name              canonical short slug (pick the clearest or invent one)
   - summary           one sentence (≤140 chars), synthesized from the group
   - count_in_sample   sum of count_in_chunk across the group
   - representative_fp_ids   pick 5-10 from the group's representatives
   - member_fp_ids     concatenation of member_fp_ids across the group (de-duped)
   - suggested_predicate   the most concrete/actionable predicate among the
                           group's predicates (or synthesize)

4. Output 1-5 final modes ordered by count_in_sample desc.

Output: write JSON to {{output_path}}:
  {
    "rule": "{{rule}}",
    "total_fps": <sum across chunks>,
    "total_unique_whys": <number — provided in input, just pass through if available>,
    "modes": [ ... merged modes as above ... ]
  }

Constraints:
  - EVERY fp_id from EVERY input chunk's member_fp_ids must appear in exactly
    ONE final mode's member_fp_ids. No fp_id may be dropped.
  - Output ONLY the JSON file.
  - NEVER ask the user a question.
````

# Failure modes

- Dedup helper fails / produces empty index → abort, fp.jsonl is malformed or empty.
- Chunk sub-agent produces invalid JSON → loop deletes file, retries. After MAX_WAVE_RETRIES → abort.
- Reduce sub-agent drops fp_ids → orchestrator validates by checking union equality; if invalid, retry up to MAX_WAVE_RETRIES; on persistent failure → abort that rule (log, continue with other rules — partial briefs are acceptable since stages 3/4/5 can skip rules without briefs).
- A rule has <10 FPs → skipped by dedup helper (per `--min-fps`). Those FPs stay in fp.jsonl without a `mode` field. Stage 3 falls back to per-shape fixtures for those (handled in stage 3 SKILL).

# Resumability

The loop only redispatches chunks/reduces whose output files are missing or invalid. Stop and restart with the same `fp-audit/state/synthesis/` and progress resumes.
