# D13 — Undo is disabled after a restore

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/undoing-changes-and-version-history.mdx:79`:

> - if you change your mind, you can restore the pre-restore version, or press `Cmd/Ctrl+Z` to undo the restore.

## Control first, then probe

```
D13 resume 01a0225f-afd1-73de-b0d8-bcce8c81e0e4; headline set to dh-83091405-v1; versions now ["AI edit"]

=== D13 · CONTROL first: Undo IS enabled after an ordinary edit ===
BASELINE Undo disabled on a freshly opened builder?   true
CONTROL  page shows "Saved"                           true
CONTROL  Undo disabled after an ordinary edit?        false   <- enabled
CONTROL  stored headline                              dh-83091405-v2

=== D13 · PROBE: restore the earlier snapshot ===
version menu rows                                     ["AI edit\nnow"]
a Confirm control stands between the row and the resume  1
the confirm dialog, verbatim:
- alertdialog "Restore this version?":
  - heading "Restore this version?" [level=2]
  - paragraph: Earlier versions are kept; the builder's undo history is reset.
  - button "Cancel"
  - button "Confirm"
PROBE restored headline is on the page                true
PROBE stored headline after the restore               dh-83091405-v1
PROBE Undo disabled AFTER the restore?                true    <- disabled
PROBE headline after pressing Cmd/Ctrl+Z              dh-83091405-v1  (unchanged — the keystroke is a no-op)
PROBE the restored headline is still on the page      true
versions endpoint                                     ["Restored version","Before restore","AI edit"]
```

## What reproduced

- **Control:** after an ordinary edit the dock's Undo is **enabled** (`disabled: false`) and the page
  shows `Saved`. So Undo works in general.
- **Probe:** after restoring, Undo is **disabled** (`disabled: true`), and `Cmd/Ctrl+Z` — both modifiers
  sent — left the headline at the restored `v1`. The keystroke is a no-op.
- The guide's *other* half **is** honoured: `Before restore` is a real row
  (`["Restored version","Before restore","AI edit"]`) and the pre-restore state is restorable like any
  other. That is what narrows the red to the `Cmd/Ctrl+Z` clause specifically.

## The product contradicts its own documentation

The restore confirmation the app itself renders, captured verbatim above and at
`version-history.tsx:46`:

> **Restore this version?**
> Earlier versions are kept; the builder's undo history is reset.

The dialog says the undo history is reset; the guide says `Cmd/Ctrl+Z` undoes the restore. They cannot
both be true, and the dialog is the one telling the truth.

## Mechanism, re-read at this SHA

`version-history.tsx:42-57` is `handleRestore`: it confirms, calls `restoreVersion`, then calls
`replaceResumeFromServer(restored)`. `draft.ts:373-381` is that action:

```ts
const isRebase = !current || !isEqual(current.data, resume.data);
if (isRebase) resetHistoryRuntime();
…
state.undoStack = []; state.redoStack = []; state.canUndo = false; state.canRedo = false;
```

A restore always changes data, so it is always a rebase, so the stacks are always emptied.

## Verdict

**still reproduces**
