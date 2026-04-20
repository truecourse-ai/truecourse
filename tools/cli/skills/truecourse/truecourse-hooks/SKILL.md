---
name: truecourse-hooks
description: Install, configure, or remove the TrueCourse pre-commit hook
user_invocable: true
triggers:
  - install the pre-commit hook
  - set up truecourse hooks
  - enable truecourse hook
  - check hook status
  - remove pre-commit hook
  - change what the hook blocks
  - edit hook config
---

# TrueCourse Hooks

Install, configure, and manage the pre-commit hook that blocks new violations before they land in git.

## Important

- **Always invoke via `npx -y`** — without `-y`, npx will hang on the "Ok to proceed?" prompt whenever the user hasn't cached the latest `truecourse` version.
- **The hook makes commits slower.** Every commit runs `truecourse analyze --diff`. On large repos that can be tens of seconds per commit. Make sure the user knows before you install.
- **Baseline required.** The hook needs a `truecourse analyze` to have run at least once in the repo — otherwise every commit is blocked with "run analyze first". If the user hasn't, suggest running `/truecourse-analyze` first (or `npx -y truecourse analyze`).
- **`hooks.yaml` is the single source of truth.** Installation creates `<repo>/.truecourse/hooks.yaml` with defaults; edit it to change policy. The file is meant to be committed so the whole team shares one hook config.

## Instructions

### 1. Figure out what the user wants

- "install", "set up", "enable" → **Install flow**
- "status", "is the hook active", "what does it block" → **Status flow**
- "uninstall", "remove", "disable" → **Uninstall flow**
- "change what blocks", "make it stricter/looser", "add/remove severities", "enable LLM" → **Configure flow**

### 2. Install flow

1. Tell the user the tradeoff upfront: commits will be slower; this repo needs a `truecourse analyze` baseline; policy lives in `.truecourse/hooks.yaml` which they should commit.
2. Run:
   ```
   npx -y truecourse hooks install
   ```
3. Relay the output. Two files get created:
   - `.git/hooks/pre-commit` (the script git invokes)
   - `.truecourse/hooks.yaml` (starter policy, blocks `critical` and `high` by default, LLM off)
4. If the user hasn't run a full analysis in this repo, suggest `/truecourse-analyze` — without it, every commit will be blocked with "no baseline" until they do.

### 3. Status flow

Run:
```
npx -y truecourse hooks status
```
Relay the output. It reports whether the hook is installed, the config path, the block severities, and whether LLM is on.

### 4. Uninstall flow

Run:
```
npx -y truecourse hooks uninstall
```
Only removes the git hook script. `hooks.yaml` is preserved (it's team policy, not install state).

### 5. Configure flow

The config lives at `<repo>/.truecourse/hooks.yaml`. Use the Read and Edit tools — do not shell out through `truecourse` for edits.

Schema:
```yaml
pre-commit:
  block-on: [critical, high]   # valid: info, low, medium, high, critical
  llm: false                   # true = LLM rules on every commit (tokens per commit)
```

Common edits the user might ask for:
- **Stricter** ("block medium too"): `block-on: [critical, high, medium]`
- **Permissive** ("only block criticals"): `block-on: [critical]`
- **Enable LLM** ("run full checks on commit"): set `llm: true`. Warn the user this spends tokens on every commit — confirm before flipping it.

After editing, run `npx -y truecourse hooks status` so they can verify the parsed values match their intent.

### 6. When the user hits a blocked commit

If a user comes to you saying "my commit got blocked" or similar:
- The hook's stdout already listed the blocking violations (file, line, title, severity).
- Offer to run `/truecourse-fix` to apply fix suggestions to those violations.
- If they want to ship anyway, remind them of `git commit --no-verify` (standard git bypass).
