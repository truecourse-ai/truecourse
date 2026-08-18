# Item 6 validation runbook — the authoring loop vs. the hand-authored baseline

**What this measures.** `truecourse guard interfaces author` authors the web tasks no
derivation produces, one agent session per place. On 2026-08-17 the same catalog was
authored BY HAND for cal.diy: **75 web tasks** across four groups
(`host-bookings-dashboard` 31, `public-booking-page` 18, `attendee-booking-links` 15,
`booking-form` 11) and **66 states**. This runbook re-authors those same four places
with the loop and diffs the result against that baseline on the axes the authoring
doctrine states.

**What it does NOT measure.** `compare.py` never decides that a difference is a
regression, and it always exits 0. The baseline is one careful human's reading, not
ground truth — a loop task the baseline lacks may be a real task the human missed. Read
the report; do not grade with it.

Everything here runs on the local machine. Nothing in this directory writes to a repo.

---

## 0. Prerequisites, and the one rule that decides whether the run counts

| | |
|---|---|
| The app repo | the local **cal.diy** checkout — every `truecourse` command below runs from ITS root, not from the truecourse repo |
| The baseline | `pr-benchmark/interfaces-pilot-2026-08-17/backup/cal.diy/interfaces.authored.json` (local only; not in git) |
| The branch under test | `claude/interface-authoring-agent-loop-sq4fbo`, built (`pnpm build`) and linked so `truecourse` resolves to it — check with `truecourse --version` and `which truecourse` |
| A derived catalog | the run needs `guard/interfaces.json`; if `truecourse guard interfaces` says "Nothing is mapped yet", run `truecourse guard setup` in cal.diy first |
| Python | 3.8+. `compare.py` is stdlib-only — no venv, no install |

### SAME-MODEL VALIDATION — read this before anything else

The loop must run **the same model family the hand baseline was authored with**. A loop
run on a smaller model produces a report that measures the model swap, not the authoring
loop, and every axis below moves for the wrong reason. The pilot baseline was authored on
the Opus tier, so:

- **claude-code transport** — every session runs on `opus` and there is no knob
  (`SESSION_MODEL_CLAUDE_CODE` in `packages/core/src/services/llm/session-driver.ts`,
  §3.4 "one model everywhere"). This is the closest match to how the baseline was written.
- **api transport, Anthropic** — configure the flagship: `claude-opus-5`. Do **not** run
  the benchmark on `claude-sonnet-5` or `claude-haiku-4-5`.

Whichever you pick, step 6 shows where the run RECORDS which model actually answered.
Paste that into the results write-up next to the report — a benchmark whose model
attribution is not stated cannot be re-read later.

---

## 1. Back up the live catalogs — the clobber hazard

`guard/interfaces.authored.json` is committed, hand-owned, and **the only home of the
surfaces no derivation produces**. Two write paths in this run touch it:

- **`author`** lays its fragment over the file by id. A place it was not asked to replace
  comes through untouched — but `--replace` (which this benchmark needs, because the four
  places already carry the hand tasks) **replaces those places' tasks outright**.
- **`reconcile`** — which the authoring run closes with automatically — rewrites state ids
  across the **whole** authored file, not only the places this run authored. A partial run
  still rewrites everything's `startingState`/`endState`.

There is no undo inside the tool. Back up first, from the cal.diy root:

```bash
cd /path/to/cal.diy
mkdir -p ../cal.diy-interfaces-backup-$(date +%Y%m%d-%H%M)
BK=$(ls -d ../cal.diy-interfaces-backup-* | tail -1)
cp .truecourse/guard/interfaces.authored.json "$BK"/          # the hand catalog — the thing at risk
cp .truecourse/guard/interfaces.json          "$BK"/ 2>/dev/null || true   # derived; cheap to re-derive, handy to have
cp -r .truecourse/scenarios                   "$BK"/ 2>/dev/null || true   # grounded on interface fingerprints
echo "$BK"
```

Confirm the backup is the 75-task baseline before you run anything that writes:

```bash
python3 /path/to/truecourse/pr-benchmark/interfaces-validation/compare.py \
  --baseline "$BK/interfaces.authored.json" \
  --candidate "$BK/interfaces.authored.json" | sed -n '/^SUMMARY/,$p'
```

Both columns should read 75 web tasks and 66 states. If they do not, you are not backing
up what you think you are — stop and find the right file.

If cal.diy is a git checkout, `git status .truecourse/guard/interfaces.authored.json`
should be clean before the run, so `git restore` is a second way back (see §8).

---

## 2. Point the loop at the right model

Check what is configured now:

```bash
truecourse config llm show     # prints the active transport, the saved API config (key masked), every stage's model
```

**Staying on Claude Code** (matches the baseline's authoring path): nothing to change —
sessions run on `opus`. Confirm the harness is logged in; the run probes the session
backend once before it spends anything, and the Agent SDK wrapper is an optional peer
(`assertSessionBackendReady`) — if it is missing, every session fails identically with an
install line.

**Flipping to the Anthropic API** — this is a **global** setting in
`~/.truecourse/config.json`, not per-repo, so it affects every repo until you flip back:

```bash
export ANTHROPIC_API_KEY=...    # or keep the key wherever it lives and name the var below

truecourse config llm setup \
  --transport api \
  --provider anthropic \
  --model claude-opus-5 \
  --api-key-env ANTHROPIC_API_KEY
```

Notes:

- `--api-key-env` stores the **name** of the env var and resolves it at run time; prefer it
  over `--api-key`, which lands the key in your shell history. `--api-key-stdin` also works.
- Setup runs a live provider probe before saving unless you pass `--no-test`.
- The `api` block persists across transport flips, so flipping back to `claude-code` later
  does not lose it.
- You can leave the global config alone and flip **per run** with
  `--llm-transport api` / `--llm-transport claude-code` on `author` and `reconcile`. Prefer
  this for a one-off benchmark: it cannot leave your machine in an unexpected mode.
  (`--llm-transport agent` is refused for `author` — an agent session needs a live backend.)
- Anthropic prompt-cache tuning is automatic and provider-chosen
  (`packages/llm-api/src/provider-tuning.ts`: `cacheControl: ephemeral` breakpoints on the
  system prompt and the moving tail, `disableParallelToolUse` so one turn is one tool call).
  There is nothing to tune by hand, and nothing to turn off for a fair comparison.

Re-run `truecourse config llm show` and confirm before proceeding.

---

## 3. Find the `--place` ids for the four groups

Place ids are derived from cal.diy's own routing tree, so they are a fact about the repo,
not a name anyone picked. The read view is free and LLM-less:

```bash
cd /path/to/cal.diy
truecourse guard interfaces          # place id · address · how many tasks are authored there
```

Map the four baseline groups onto those ids by **address**. The baseline's own
group→address map, straight out of the backup:

```bash
python3 - "$BK/interfaces.authored.json" <<'PY'
import json, sys, collections
cat = json.load(open(sys.argv[1]))
m = collections.defaultdict(set)
for i in cat["interfaces"]:
    if i.get("type") == "web":
        m[i.get("group", "(no group)")].add(i["entry"]["path"])
for g, paths in sorted(m.items()):
    print("{:<28} {}".format(g, ", ".join(sorted(paths))))
PY
```

Fill this in before you run — the addresses are the join key, and a place id that matches
no baseline address means you are about to author a fifth place:

| baseline group | baseline address(es) | place id from `guard interfaces` |
|---|---|---|
| `host-bookings-dashboard` | | |
| `public-booking-page` | | |
| `attendee-booking-links` | | |
| `booking-form` | | |

If one group's tasks span two addresses, it needs two `--place` flags. A session authors
ONE screen plus the dialogs and panels sitting on it; a task located anywhere else is
refused by `validateFragment` (`draft.ts` rule 4), so over-selecting is safe and
under-selecting silently costs you tasks.

---

## 4. Run the authoring

```bash
cd /path/to/cal.diy
truecourse guard interfaces author \
  --place <host-dashboard-id> \
  --place <public-booking-page-id> \
  --place <attendee-links-id> \
  --place <booking-form-id> \
  --replace \
  --concurrency 2
```

- `--replace` is **required**: without it, places that already carry the hand tasks are
  skipped and the run authors nothing. This is the flag that consumes your backup — §1 is
  not optional.
- `--concurrency` defaults to `min(cpus, 4)`. Sessions cannot see each other, so higher
  concurrency mints more state synonyms for the closing reconcile to collapse; 2 keeps the
  spinner readable and the reconcile's job smaller. `--limit N` caps the place count.
- Drop `-y` (do not pass it) so you see the pre-flight: the place list, the per-session
  turn ceiling, and the reminder that one closing reconcile call is part of the bill.
- The run is resumable in the sense that matters: a run that dies after two places leaves
  two places authored and the rest of the file untouched.

**What the footer tells you** (all of it goes in the write-up):

```
<N> session(s) on <provider>/<model> via <mode>     ← the model attribution, per §0
context   <P> place(s) grounded from <F> file(s) in <S>s
authored  <T> task(s)
states    <before>→<after> (<merged> merged)
turns     <turns>
tokens    <tokens>
cost      $<usd>                                    ← api mode only; claude-code prints no cost line
written   .../guard/interfaces.authored.json
sessions  .../.truecourse/sessions/guard-interfaces/<runId>
```

Per place you get one of four outcomes: `authored` (with the task ids), `empty` (no task
the source states — an honest result, not a failure), `rejected` (the draft broke the rules
and was dropped, with the reasons), `failed`. `rejected`/`failed` set exit code 1. Anything
a session could not settle is printed under `unresolved:` — copy those lines out, they are
the qualitative half of this benchmark.

### Reading `states N→M (K merged)`

This is the state reconciliation (`packages/interface-author/src/reconcile.ts`), printed by
both the run footer and the standalone command:

- **N** — registry size before the pass, **M** — after, **K = N − M** — ids absorbed.
- `120→64 (56 merged)` means the sessions minted 56 synonyms for worlds already named, and
  the pass collapsed them. **High K is expected and healthy** on a multi-place run: sessions
  run blind to each other by design, and this pass is why that is affordable.
- `states 64→64 (0 merged)` means the registry already said each world once.
- Collapses print as `keep ← absorbed, absorbed`. Proposed groups that broke a guardrail
  print as `Dropped N proposed group(s)` — one bad group never costs the run its good ones.
- If the pass reports **rejected**, the rewrite failed the merged catalog's own schema and
  **nothing was written** — the registry stands as it was, and the exit code is 1.
- Renaming a state moves **no fingerprint** (`interfaceFingerprint` covers `type` + `entry` +
  `steps` only), so reconciling invalidates no scenario. It is safe to re-run.

Compare M against the baseline's **66** states — that is the axis-3 headline.

---

## 5. Reconcile again if you need to (optional)

The authoring run already closed with this pass, so run it standalone only if the run died
before it, or if you authored the four places across several partial runs:

```bash
truecourse guard interfaces reconcile        # add -y to skip the confirm, --llm-transport to pin the mode
```

ONE model call whatever the app's size. Idempotent: a reconciled registry reconciles to
itself, so running it twice is free of surprises (it still costs one call).

---

## 6. Where the provider/model attribution lives

Three places record it, and they agree by construction:

1. **The CLI footer** — `N session(s) on <provider>/<model> (fallback <model>) via <mode>`.
2. **The run record** — `.truecourse/sessions/guard-interfaces/<runId>/run.json`, field
   `llm: { mode, provider, model, fallbackModel? }`:
   ```bash
   python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['llm'])" \
     .truecourse/sessions/guard-interfaces/<runId>/run.json
   ```
3. **Every transcript** — the `session-start` event of each `<sessionId>.jsonl` in that same
   directory stamps it, so a transcript read after a config change is still interpretable.

`<runId>` is the newest directory under `.truecourse/sessions/guard-interfaces/`. Record
mode + provider + model with the report; without them the numbers are not reproducible.

---

## 7. Compare

```bash
cd /path/to/cal.diy
python3 /path/to/truecourse/pr-benchmark/interfaces-validation/compare.py \
  --baseline "$BK/interfaces.authored.json" \
  --candidate .truecourse/guard/interfaces.authored.json \
  | tee ~/interfaces-loop-vs-hand-$(date +%Y%m%d-%H%M).txt
```

Defaults, if you run it with no flags: baseline
`pr-benchmark/interfaces-pilot-2026-08-17/backup/cal.diy/interfaces.authored.json`,
candidate `.truecourse/guard/interfaces.authored.json`, both relative to the working
directory.

The script **always exits 0** — it is a report, not a gate. A file that is missing or
unparseable is reported as `n/a` in the affected columns and the reason is written to
**stderr** as well as into the INPUTS section, so check stderr if a whole column reads
`n/a`. Output is deterministic: same inputs, byte-identical report, so two runs diff
cleanly.

### How to read each axis

**AXIS 0 — SHAPE.** Field presence is reported, never scored. The baseline carries
`group` + `entry` + a stored `fingerprint` and no `at`/`to`; loop entries carry `at`/`to`
because a session is scoped to a place. Both are normalized away before anything is
compared (`at` → first `navigate` route → `entry.path`). What to actually look at here:
unknown fields, step kinds outside the web union, and stored fingerprints that disagree
with the recomputed value.

**AXIS 1 — TASK COVERAGE.** The headline. Identity is the recomputed fingerprint
(reimplemented byte-for-byte from `packages/shared/src/interfaces.ts`), so a task the loop
authored under a different id still matches — read "same task, different id" as a naming
difference, not a miss. Then:
- *recall of the baseline* — how much of the human's reading the loop reproduced.
- *candidate tasks with no baseline counterpart* — read every one. Some are real tasks the
  human missed; some are page inventory.
- *page-inventory smell* — pagination, sorting, chrome. The doctrine refuses these
  explicitly ("A screen whose only controls are these has ZERO tasks"). Hits are prompts to
  look, not verdicts: a filter is a legitimate task and matches the same keywords.
- *duplicates within a file* — a fingerprint appearing twice violates "one invocable thing
  is one entry" and should be zero on both sides.

**AXIS 2 — LOCATOR GRAMMAR.** Every `activate`/`input` target must be
`<role> "<accessible name>"` over a role `GUARD_WEB_ROLES` knows. The write path enforces
this, so the honest expectation is **zero violations on the candidate**; a non-zero count
means something bypassed `validateFragment` and is worth a bug. The role histogram is the
qualitative read: a candidate that is all `button` where the baseline used
`gridcell`/`combobox`/`switch` is authoring coarser locators even at equal counts.

**AXIS 3 — STATES.** Not the registry size alone — the **reuse ratio** (references per
distinct id). A registry as large as the task list is a per-task sentence, not a
vocabulary. Also: ids referenced but never defined (the merged catalog would refuse those),
ids defined but never referenced, and the synonym families (`x-created` / `x-exists` /
`x-updated`) that `reconcile` is supposed to have collapsed — a long family list after a
run means the reconcile did not land, so check its status.

**AXIS 4 — apiEffects TRI-STATE.** Three genuinely different claims: **omitted** = the
session established nothing; **`[]`** = it established that the task reaches no server at
all (the stronger claim); **non-empty** = named api ids. A candidate that never writes `[]`
is not making the stronger claim anywhere; one that never omits is guessing, which the
doctrine forbids. Candidate-only api ids should each be an id the api catalog actually
defines — the merged catalog refuses any that are not.

---

## 8. Restore

```bash
cd /path/to/cal.diy
cp "$BK/interfaces.authored.json" .truecourse/guard/interfaces.authored.json
```

In a git checkout, `git restore .truecourse/guard/interfaces.authored.json` does the same
(the file is tracked) — but only if it was clean before the run, which §1 asked you to
confirm.

Then, if you flipped the global transport in §2 and want it back:

```bash
truecourse config llm setup --transport claude-code
truecourse config llm show
```

Leave the run directories under `.truecourse/sessions/guard-interfaces/` alone — they are
gitignored, and they are the evidence for the write-up. `.truecourse/guard/interfaces.json`
is derived and gitignored; if you restored it from the backup, nothing is harmed either way.

---

## 9. Cost expectation

**Per place**: one agent session, budget `30 turns × (1 automatic resume + 1) = 60 turns`
maximum, with a **150,000-token context ceiling** so compaction never runs
(`INTERFACE_AUTHOR_BUDGET` in `packages/interface-author/src/session.ts`). Most sessions
converge in a handful of turns — the budget covers a wrong first guess about which file
renders the screen, not an infinite loop.

**Per run**: four sessions, plus exactly **one** closing reconcile call over the whole state
registry (the `guard.stateReconcile` stage) whatever the app's size. Plus a free,
LLM-less context pass over the working tree before the first session starts.

| transport | what it costs | where you see it |
|---|---|---|
| `claude-code` | billed against your Claude subscription through the harness; the runner prices nothing, so the footer prints **no `cost` line** | your Claude usage, not the CLI |
| `api` (Anthropic) | priced per call and totalled | the footer's `cost $X.XX`, per-call inside the run record |

Order of magnitude for the api path on the Opus tier ($5/M input, $25/M output): sessions
that converge in roughly 8–12 turns, with Anthropic prompt caching doing the heavy lifting
on the resent history, land the four places in the **low single-digit dollars**. The
absolute ceiling is worth knowing before you press enter: four sessions each burning all 60
turns against a full 150K context is ~36M input tokens, i.e. low hundreds of dollars if
literally nothing cached. That gap is why the pre-flight confirm exists — read the place
list, then watch the `cost` line in the footer rather than trusting either end of the range.

Re-running is not free: authoring has no result cache, and `--replace` re-authors from
scratch every time.

---

## 10. What to hand back

1. The report file from §7 (it is self-describing and diffable).
2. The run footer verbatim, including `states N→M (K merged)` and the model attribution line.
3. `llm { mode, provider, model }` from the run record (§6).
4. The `unresolved:` lines from every place — what the loop refused to guess is a result.
5. Any place that came back `rejected` or `failed`, with its reasons.
