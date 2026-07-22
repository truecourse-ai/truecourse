# node-semver — documentation findings

**Target:** [npm/node-semver](https://github.com/npm/node-semver), version 7.8.5 (commit `6e05b76`, cloned from source, 2026-07-16)
**Method:** TrueCourse (v0.7.3-next.6) generated executable test scenarios from node-semver's own documentation (`README.md`) and ran them against the current CLI (`node bin/semver.js`) in a clean sandbox. Every finding below was then re-verified by hand against the live CLI before being listed. Scenarios the automated review attributed to its own test-generation shortfalls are excluded.
**Tracker cross-check:** every finding was searched against node-semver's GitHub issues and PRs (open and closed) on 2026-07-16.

## Summary

2 verified divergences between the `semver -h` help text pasted into `README.md` and what the CLI actually prints. Both are documentation drift: the CLI output is the source of truth and behaves correctly (exit 0, all options present); the README's copy of the help block is stale. Neither is tracked as an open issue, but both touch README lines with prior tracker activity — one a closed 2016 report of the same symptom, the other a 2026 PR that set out to fix this exact block and left residual drift. Tracker classification: **0 exact, 2 related, 0 unreported.**

Of the scenarios generated from the README, 49 were kept and all pass against the current CLI; 29 were set aside by the automated review as test-generation shortfalls (see notes); these 2 flagged the drift below.

## Findings

Both findings concern the same block — the fenced `$ semver -h` output under **Usage** in `README.md` (lines 89–138). One line reproduces both:

```
node bin/semver.js -h   # compare against README.md lines 89–138
```

| # | Finding | Tracker status |
|---|---------|----------------|
| 1 | **README omits the version banner the CLI prints first.** The live `semver -h` output opens with `SemVer 7.8.5` followed by a blank line, before `A JavaScript implementation of the https://semver.org/ specification`. The README block jumps straight from `$ semver -h` to the `A JavaScript implementation…` line — the banner line is absent. | **Related.** Issue #160 (closed, completed, 2016) reported this exact divergence — the CLI's `SemVer <version>` banner missing from the README help block — and it was reconciled at the time. It has since re-drifted; there is no open issue for the current recurrence. |
| 2 | **README's `-n` option entry does not match the CLI's, in wording and position.** README documents (between `-l --loose` and `-p --include-prerelease`): `-n <0\|1\|false>` / `Base number for prerelease identifier (default: 0).` / `Use false to omit the number altogether.` The CLI prints (as the last option, after `--ltr`): `-n <base>` / `Base number to be used for the prerelease identifier.` / `Can be either 0 or 1, or false to omit the number altogether.` / `Defaults to 0.` The placeholder, all three description lines, and the entry's position differ. | **Related.** PR #836 (merged, Jan 2026, "docs: fix typos and update -n CLI option documentation") changed this block from `-n <0\|1>` to the current README wording *intending* to match the CLI help, but the wording it introduced still diverges from `semver -h`, and it left the entry in the pre-`-p` position rather than the CLI's end-of-list position. |

## Notes on interpretation

- Both findings are facets of one stale artifact: the help text pasted into the README's Usage block has fallen behind the CLI's actual output. They matter because a reader comparing the documented help to the real `semver -h` sees a missing top line and a mismatched `-n` entry. The fix is a one-block documentation edit; no code change is implied.
- **29 generated scenarios were excluded as test-generation mistakes, not code or documentation defects.** In each case the scenario under-tested a two-sided claim — for example, asserting that `>=1.2.7` prints the versions that match while never feeding it the versions that should be rejected, so a regression in the exclusion half would have left the test green. A hand-sample of six (across both exclusion categories the review used) confirmed every one: the code and documentation agree in all six, and the fuller-coverage sibling scenarios that do exercise both halves were the ones kept. None of the exclusions buried a real divergence. Three of the excluded behaviors were also independently re-run against the live CLI (`*` excluding prereleases by default and including them under `-p`; `>=1.2.7` rejecting `1.2.6`/`1.1.0`; `~1.2.3-beta.2` rejecting `1.2.4-beta.2`) and all behaved as documented.
- **The scenarios are bounded by what the README states as CLI-checkable behavior.** Three known open/closed bugs in this project — #775 (coercing a prerelease identifier that starts with digits truncates it), #757 (`subset()` wrongly returns false for some prerelease subsets), and #751 (`inc` premajor/preminor/prepatch misbehaves when the version is already a prerelease) — are **not** covered by the 49 committed scenarios. #775 and #757 concern library functions (`coerce`, `subset`) the README documents only through the JavaScript API, with no CLI-observable example to assert against. #751's construct (premajor/preminor/prepatch applied to an already-prerelease version) is a behavior the README's increment section lists as a level but never specifies concretely, so no scenario pins it. These are outside what the README states, not gaps the generated scenarios failed to catch.
