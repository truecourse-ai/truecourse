---
name: truecourse-list
description: List TrueCourse violations found in this repository
user_invocable: true
triggers:
  - show violations
  - list issues
  - what violations were found
  - show diff results
---

# TrueCourse List

Show violations and analysis results from TrueCourse.

## Important

- **Always pass `-y` to `npx`** so it doesn't hang on the install prompt: `npx -y truecourse ...`.
- **Plain `list` paginates** — it shows the first 20 violations by default. If the output says "Showing 1–20 of N violations" and N is larger than what you need to present, re-run with `--all` (or use `--limit` / `--offset` to page) so you don't silently hide results from the user.

## Instructions

### 1. Pick mode
Determine whether the user wants **full violations** (from the last full analysis) or **diff results** (changes since the last full analysis). If they said "diff" in their request, use diff mode.

- Full: `npx -y truecourse list`
- Full (all, no pagination): `npx -y truecourse list --all`
- Diff: `npx -y truecourse list --diff`

### 2. Run and present

Use the Bash tool. The output is already formatted — show it as-is.

If stdout indicates "Showing X–Y of N violations" and the user asked for the full picture, re-run with `--all` and present that instead.

### 3. Next step

If violations have **Fix:** suggestions attached, mention that `/truecourse-fix` can apply them.
