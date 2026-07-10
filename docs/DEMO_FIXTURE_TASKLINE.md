# Demo fixture: `taskline` — a small CLI target for scan → guard demos

STATUS: PLANNED 2026-07-09 (user request: a small standalone CLI fixture repo to run
TrueCourse against for testing and a demo video; scan + generate must be fast/cheap).

## What it is

A **standalone git repo** at `/Users/musheghgevorgyan/repos/taskline` (NOT inside the
truecourse repo — guard/scan resolve the git root, so the fixture must be its own repo).
A realistic, tiny task-tracker CLI: plain Node ESM, **zero dependencies, zero build step**
— the guard recipe becomes trivial (`entry: ["node", "bin/taskline.js"]`) and every
scenario run is instant. Realistic code and prose only (house rule: fixtures are never
dummy/synthetic) — it must read like a small OSS tool someone actually ships.

## The tool

- **Storage**: `.taskline/tasks.json` under the cwd (created by `init`; every command
  errors with exit 2 and a clear message when the store is missing — documented).
- **Determinism by design** (guards need it): sequential ids `t1, t2, …`; "today" comes
  from `TASKLINE_TODAY=YYYY-MM-DD` when set (documented feature "for scripting and
  tests"), else the system date; no prompts anywhere (non-interactive by design — avoids
  the stacked-gates failure mode); no network; no randomness; stable sort orders.
- **Commands** (~7, each with 2–4 documented behaviors → ~15–22 claims):
  - `taskline init` — creates the store; exit 0; re-init on an existing store exits 1
    with "already initialized".
  - `taskline add <title> [--priority high|med|low] [--due YYYY-MM-DD]` — prints
    `Added t<N>: <title>`; invalid priority exits 1 naming the valid set; invalid date
    exits 1.
  - `taskline list [--all|--done]` — default shows open tasks sorted by priority then id;
    `--done` only completed; `--all` everything; empty store prints "No tasks." exit 0.
  - `taskline done <id>` — marks complete; unknown id exits 2 with `No such task: <id>`.
  - `taskline rm <id>` — removes; unknown id exits 2.
  - `taskline stats` — one line: `N open · M done · K overdue` (overdue = due < today).
  - `taskline export --format json|csv [--out <file>]` — stdout by default; `--out`
    writes the file; unknown format exits 1.
- **Exit-code contract** (documented in SPEC): 0 success, 1 usage/validation error,
  2 missing store or unknown id.
- Size target: 300–500 lines across `bin/taskline.js` + `src/*.js` (3–4 modules), plus a
  small `node:test` smoke suite (realism; must pass).

## The doc corpus (3 docs → fast scan, a handful of areas)

- `README.md` — badges-free simple header + one-paragraph pitch **in the preamble that
  carries one side of the seeded conflict** (see below), quick start, commands table,
  determinism note (`TASKLINE_TODAY`), exit codes summary.
- `docs/SPEC.md` — the behavior spec: storage format, id scheme, exit-code contract,
  per-command behaviors (this is the main claim source).
- `CHANGELOG.md` — 3–4 short entries (realism; adds a relations/chain candidate).

## Seeded imperfections (exactly these, nothing else)

1. **Doc↔doc conflict (for the scan conflicts demo, incl. preamble highlight)**:
   README's **preamble** says `rm` *permanently deletes* a task; `docs/SPEC.md`'s "rm"
   section says removed tasks are *archived and restorable for 7 days*. The CODE does
   permanent delete (README is right). One conflict, two pointers — one of them the
   preamble.
2. **Drift A (finding demo)**: docs say `done` prints `Completed t<N> ✓`; code prints
   `Marked t<N> as done`. Same section also documents the exit-2 unknown-id behavior,
   which the code honors → that sibling claim births green and becomes a **held**
   scenario behind Drift A's finding (demos the held ledger + release-on-fix).
3. **Drift B (second finding, different section)**: docs say `export --format csv`
   includes a header row `id,title,priority,due,status`; code writes rows only.

**Everything else must match the docs exactly** — the demo's credibility depends on
guard producing exactly these findings and no accidental ones. The review agent's core
job is claim-by-claim verification that no third drift exists.

## Git shape

Own repo, `main` branch, 4–5 realistic commits (scaffold → commands → export/stats →
docs polish), `git init` fresh (no remote). `.gitignore` for `.taskline/` test debris +
`node_modules/`. Committed clean.

## Out of scope

No CI, no publishing, no TypeScript, no deps, no interactive prompts, nothing that makes
scan/generate slower. The seeded-imperfection list above lives ONLY in this plan doc —
the fixture repo itself must contain no meta-commentary about being a fixture or about
the seeded drifts (the scan reads every `.md`).

## Demo flow this enables (for the video)

add repo → scan (estimate modal → conflict appears, preamble highlighted, resolve it) →
generate (estimate → findings for Drifts A+B with YAML + evidence, held sibling visible,
blast radius on the finding) → dismiss or fix a drift → regenerate (held scenario lands)
→ guard run (all green, pass evidence) → live-break a command (à la the hooks demo) →
run → red with transcript → revert → green.
