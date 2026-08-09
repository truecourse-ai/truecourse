> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Baselines & diff

> Commit a baseline once, then see only what your changes introduce.

The first `truecourse analyze` creates `.truecourse/` in your repo. Three files inside it are committable and travel with the repo:

| File          | Purpose                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `LATEST.json` | Most recent analysis snapshot. Doubles as the baseline for `truecourse analyze --diff` and the pre-commit hook. |
| `config.json` | Per-repo rule categories and LLM toggles.                                                                       |
| `hooks.yaml`  | Pre-commit hook policy (created by `truecourse hooks install`).                                                 |

Everything else (`analyses/`, `diff.json`, `history.json`, `ui-state.json`, `logs/`, `.analyze.lock`) is local-only and added to `.truecourse/.gitignore` automatically. See [Storage](/configuration/storage) for the full layout.

## Setting the baseline

First time, on `main`:

```bash theme={null}
truecourse analyze
git add .truecourse/LATEST.json .truecourse/config.json
git commit -m "add truecourse baseline"
```

**Refreshing the baseline:** re-run `truecourse analyze` after merging to `main` and commit the updated `LATEST.json`.

<Warning>
  Don't commit `LATEST.json` from feature branches: two PRs both updating it will conflict on a large generated JSON. Commit it only after merging to `main`.
</Warning>

## Diff analysis

```bash theme={null}
truecourse analyze --diff       # New/resolved violations from your uncommitted changes
truecourse list --diff          # Show the diff results
```

`analyze --diff` compares your working tree against the committed baseline and reports only the violations your changes **introduce** (and the ones they **resolve**). The result lands in `.truecourse/diff.json` (gitignored, per-checkout, overwritten each diff run).

This is the same check the [pre-commit hook](/analyze/git-hooks) runs on every commit.

## Worktrees and fresh clones

`LATEST.json` is tracked, so `git worktree add ../feat-x` and fresh clones inherit the baseline through git. `truecourse analyze --diff` and the pre-commit hook both work on the first commit in a new worktree, with no per-checkout cold-start. Inside a worktree, run `truecourse analyze --diff` to see what your in-flight changes introduce relative to `main`'s committed baseline.

## Dirty working trees

A full `truecourse analyze` wants a clean tree so the snapshot maps to a commit. On a dirty tree it prompts before stashing:

```bash theme={null}
truecourse analyze --stash      # Pre-approve stashing pending changes (CI-friendly)
truecourse analyze --no-stash   # Analyze the working tree as-is, no stash
```

## Next steps

<CardGroup cols={2}>
  <Card title="Git hooks" icon="code-branch" href="/analyze/git-hooks">
    Block commits that introduce new violations, using this baseline.
  </Card>

  <Card title="Storage" icon="database" href="/configuration/storage">
    The full committable vs gitignored layout of .truecourse/.
  </Card>
</CardGroup>
