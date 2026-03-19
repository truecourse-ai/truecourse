---
name: truecourse-fix
description: Fix TrueCourse violations that have suggested fixes
user_invocable: true
triggers:
  - fix violations
  - apply fixes
  - fix my code
---

# TrueCourse Fix

Apply fixes for TrueCourse violations that have fix suggestions.

## Instructions

1. First, fetch the current violations by running:
   ```
   npx truecourse list
   ```

2. Parse the output to identify violations that have a **Fix:** suggestion. These are the only violations that can be automatically fixed.

3. If no violations have fix suggestions, tell the user and stop.

4. Present the fixable violations to the user as a numbered list with their title, severity, and target location. Ask which ones they'd like to fix (they can pick specific numbers or say "all").

5. For each selected violation, read the fix suggestion and apply it to the codebase:
   - The fix suggestion describes what code change to make
   - Use the Read tool to read the relevant source file(s)
   - Use the Edit tool to apply the fix
   - Explain what you changed

6. After applying fixes, suggest the user run `/truecourse-analyze` again to verify the fixes resolved the violations.
