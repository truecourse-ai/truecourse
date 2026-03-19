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

## Instructions

1. Determine whether to show **full violations** or **diff results**. If the user mentioned "diff" in their request, use diff mode.

2. Run the appropriate command using the Bash tool:
   - **Full violations:** `npx truecourse list`
   - **Diff results:** `npx truecourse list --diff`

3. Present the output to the user. The command output is already formatted — show it as-is.

4. If violations with fix suggestions are found, tell the user they can run `/truecourse-fix` to apply fixes.
