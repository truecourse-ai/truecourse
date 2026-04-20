---
name: truecourse-fix
description: Fix TrueCourse violations that have suggested fixes
user_invocable: true
triggers:
  - fix violations
  - apply fixes
  - fix my code
  - fix diff violations
---

# TrueCourse Fix

Apply fixes for TrueCourse violations that have fix suggestions.

## Important

- **Always invoke via `npx -y`** — without `-y`, npx will hang on the "Ok to proceed?" prompt whenever the user hasn't cached the latest `truecourse` version.
- **Default to the diff flow.** Users usually want to fix the violations introduced by the changes they're currently iterating on — not the whole repo. Start by asking which set to fix.
- **Only violations with a `Fix:` block can be auto-fixed.** Violations without one require human design decisions; mention them but don't attempt them.

## Instructions

### 1. Pick the violation set

Ask: *"Do you want to fix violations from the latest full analysis, or just the changes you're working on right now (diff)?"*

- **Diff mode** (recommended default): `npx -y truecourse list --diff` — small set, usually fine to load in one call.
- **Full mode**: start with a paged view, `npx -y truecourse list` (first 20). If the summary line shows a large total and the user hasn't narrowed scope, ask them to narrow before pulling more pages:
  - by severity (e.g. "just critical and high") — there's no server-side filter flag yet, so page through and keep only matches.
  - by a specific file / module / service they care about — same approach.

  Avoid `--all` on large repos — it dumps every violation into context even though most won't be fixable.

If `list --diff` returns "no diff results yet" or "stale diff", suggest the user first run `/truecourse-analyze` in diff mode.

### 2. Identify fixable violations

From the output in hand, keep only violations that contain a `Fix:` block — those are the ones with actionable fix suggestions. If you loaded only one page in full mode, tell the user how many were fixable on this page and offer to continue to the next page (`--offset 20`, `--offset 40`, …) if they want more.

If none on the loaded page(s) are fixable, tell the user and stop (or offer to page further).

### 3. Present and select

Show the fixable violations as a numbered list with title, severity, and target location. Ask which ones to fix (they can pick numbers or say "all").

### 4. Apply

For each selected violation:
- Read the `Fix:` text.
- Use the Read tool to load the relevant source file(s).
- Use the Edit tool to apply the change.
- Briefly describe what you changed.

### 5. Re-verify

After fixes, suggest the user re-run the appropriate analysis to confirm the violations are resolved:

- If you worked in **diff mode**: run `npx -y truecourse analyze --diff --no-llm` (fast, free). If they want LLM rules re-checked too, use `--llm` and relay the cost estimate first.
- If you worked in **full mode**: suggest `/truecourse-analyze` so the user picks the LLM/no-LLM decision fresh.
