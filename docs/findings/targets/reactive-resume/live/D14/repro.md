# D14 — a template switch is an ordinary throttled autosave, not a snapshot

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


> **Only the sharpened statement is re-run here.** The corpus's original wording — "a template switch
> writes NO new version row" — is true only of the state the corpus scenario happens to be in, and must
> not be filed. What is re-run is: *a template switch is an ordinary throttled autosave, not a snapshot
> moment; on a virgin resume it writes one row labelled `Manual save` that never names a template; and
> further switches inside the two-minute throttle write nothing.*

**Doc quotes**, `docs/guides/undoing-changes-and-version-history.mdx:44-47` and `:57`:

> Reactive Resume automatically snapshots your resume at key moments: … - when you switch templates;

> The menu lists recent snapshots newest first, each with a label describing what triggered it …

## Probe — both states, switches driven through the real Template Gallery

```
=== D14 · PROBE B: a VIRGIN resume with no snapshot at all (the sharpened statement) ===

B versions before any switch              []
B template before any switch              azurill
B template after SWITCH 1                 bronzor
B page shows "Saved"                      true
B versions after SWITCH 1                 ["Manual save"]   <- a row DID appear
B template after SWITCH 2                 chikorita
B versions after SWITCH 2 (seconds later) ["Manual save"]   <- no second row
B template after SWITCH 3                 gengar
B versions after SWITCH 3                 ["Manual save"]   <- still none

B the one row's label is ["Manual save"] — it never names a template.


=== D14 · PROBE A: a resume that ALREADY carries a snapshot (the corpus's situation) ===

A versions before the switch              ["AI edit"]
A template after the switch               bronzor      (the switch really happened)
A page shows "Saved"                      true
A versions AFTER the template switch      ["AI edit"]  <- no new row
A CONTROL versions after a checkpointing write  ["AI edit","AI edit"]

Mechanism (service.ts:67-69, :107, :669-678): a template switch goes down the ORDINARY update path,
which calls maybeSnapshotOnSave with the fixed label "Manual save" and returns without writing when the
newest snapshot is younger than SNAPSHOT_THROTTLE_MS (2 min). The comment on that branch says the
debounced milestone "Covers template switches and typing."
```

## What reproduced

**Probe B, the virgin resume — this is the sharpened statement, and it holds exactly.**

- Versions before any switch: `[]`.
- Switch 1 (`azurill → bronzor`): the template really changed, the page said `Saved`, and **one row
  appeared**, labelled **`Manual save`**. It does not name a template — not `bronzor`, not "template".
- Switch 2 (`→ chikorita`) and switch 3 (`→ gengar`), seconds later: both switches persisted, and the
  version list stayed at `["Manual save"]`. **The throttle swallowed them.**

So a template switch is not a key moment with its own label; it is the generic debounced autosave, and
whether it records anything depends only on the clock.

**Probe A, the corpus's situation.** A resume already carrying an `AI edit` snapshot: the switch
persisted (`bronzor`), the page said `Saved`, and the version list did **not** grow.

**Control.** On that same resume, an explicit checkpointing write seconds later **did** add a row
(`["AI edit"] → ["AI edit","AI edit"]`), so the list is not simply frozen — only the switch is throttled out.

## Mechanism, re-read at this SHA

```
packages/api/src/features/resume/service.ts:67-69
  // Manual-save milestones are debounced server-side: an autosave only checkpoints if the newest
  // snapshot is older than this. Explicit milestones (import, AI edit, restore) always checkpoint.
  const SNAPSHOT_THROTTLE_MS = 2 * 60 * 1000;

packages/api/src/features/resume/service.ts:107
  if (latest && Date.now() - latest.createdAt.getTime() < SNAPSHOT_THROTTLE_MS) return;

packages/api/src/features/resume/service.ts:669-678
  // Debounced manual-save milestone: only snapshots data edits, and only when the previous
  // snapshot is old enough (see SNAPSHOT_THROTTLE_MS). Covers template switches and typing.
  if (input.data !== undefined && !input.skipAutoSnapshot) {
    await maybeSnapshotOnSave({ …, label: "Manual save" });
  }
```

The comment at `:670` is explicit that the debounced milestone "Covers template switches and typing" —
i.e. a switch is not a distinct trigger at all.

## Verdict

**still reproduces** (the sharpened statement, both probes and the control)
