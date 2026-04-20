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

## Important

- **Full analysis** stashes any uncommitted changes, analyzes the clean working tree, then unstashes. The user's uncommitted work is preserved.
- **Diff check** analyzes the full working tree (including uncommitted changes — it does NOT stash) and compares the result against the last full analysis baseline. The report lists violations newly introduced and violations resolved since that baseline. Prefer diff for in-progress work where the user is iterating on changes.
- **Always pass `-y` to `npx`** so it doesn't hang on the "Ok to proceed?" install prompt: `npx -y truecourse ...`.
- **Always pass `--no-skills`** — the flag skips the first-run skills prompt silently.
- **LLM rules cost real money.** Never pass `--llm` without first relaying the cost estimate to the user and getting approval. See the LLM flow below.

## Instructions

### 1. Pick mode
Ask the user whether they want a **full analysis** or a **diff check**. If they said "diff" in their request, default to diff.

- Full: `npx -y truecourse analyze ...`
- Diff: `npx -y truecourse analyze --diff ...`

### 2. Decide on LLM rules

LLM rules add higher-value insights but cost money per run. Ask the user one question: **"Run LLM-powered rules this time?"** If the user is unsure, offer to run deterministic-only first (free, fast) and add LLM later.

- If **user approves LLM**: append `--llm --no-skills` to the command.
  Example: `npx -y truecourse analyze --llm --no-skills`
- If **user declines LLM or wants a free run**: append `--no-llm --no-skills`.
  Example: `npx -y truecourse analyze --diff --no-llm --no-skills`

You MUST pass either `--llm` or `--no-llm` — running without either in a non-interactive shell will exit with an error naming the flags.

### 3. Run the command

Use the Bash tool. This is long-running (minutes, especially with `--llm`) — use a timeout of at least 600000ms (10 minutes).

### 4. Summarize

When the command finishes, summarize the stdout for the user:
- Total violations by severity
- Number of changed files (diff mode)
- Any errors

### 5. Next steps

Tell the user they can:
- Run `/truecourse-list` to see the full violation list.
- Run `/truecourse-fix` to apply suggested fixes.
