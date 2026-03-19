---
name: truecourse-analyze
description: Run TrueCourse architecture analysis on this repository
user_invocable: true
triggers:
  - analyze this repo
  - run analysis
  - check my code
  - run a diff check
---

# TrueCourse Analyze

Run architecture analysis on the current repository using TrueCourse.

## Instructions

1. Ask the user whether they want a **full analysis** or a **diff check** (changes only). If they mentioned "diff" in their request, default to diff mode.

2. Run the appropriate command using the Bash tool:
   - **Full analysis:** `npx truecourse analyze`
   - **Diff check:** `npx truecourse analyze --diff`

3. This is a long-running command (can take several minutes). Let it run to completion — do NOT set a short timeout. Use a timeout of at least 600000ms (10 minutes).

4. When the command finishes, summarize the output for the user:
   - Number of violations found (by severity)
   - Number of changed files (for diff mode)
   - Any errors that occurred

5. After summarizing, tell the user they can run `/truecourse-list` to see the full violation details, or `/truecourse-fix` to apply suggested fixes.
