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

- **Always invoke via `npx -y`** — without `-y`, npx will hang on the "Ok to proceed?" prompt whenever the user hasn't cached the latest `truecourse` version.
- **Don't dump everything at once.** Plain `list` shows the first 20 violations — use that by default. Large repos can have hundreds; pasting them all wastes context and the user can't read that much in one go. Page or filter instead.

## Instructions

### 1. Pick mode
Determine whether the user wants **full violations** (from the last full analysis) or **diff results** (changes since the last full analysis). If they said "diff" in their request, use diff mode.

- Full: `npx -y truecourse list`
- Diff: `npx -y truecourse list --diff`

### 2. Run and present

Use the Bash tool. The output is already formatted — show it as-is.

The final line summarises totals, e.g. `Showing 1–20 of 287 violations (12 critical, 45 high, ...)`. Lead your reply with that total + severity breakdown so the user knows the scope before scanning the first page.

### 3. Offer the next step

After showing the first page, ask the user what they want:
- **Page further** — use `--offset <n>` (next page is `--offset 20`, then `--offset 40`, …) or widen with `--limit <n>`.
- **Everything in one view** — `--all` (only when the user explicitly asks for the full dump, e.g. "show all of them", "give me the whole list"). Avoid by default.
- **Start fixing** — `/truecourse-fix` (only for violations with a `Fix:` block attached).
