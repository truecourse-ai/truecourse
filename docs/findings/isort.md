# isort — documentation & behavior findings

**Target:** [PyCQA/isort](https://github.com/PyCQA/isort), version 9.0.0b2.dev11 (editable install from source at commit `68356ea`, 2026-07-17)
**Method:** TrueCourse guard generated executable test scenarios from isort's own documentation (`README.md`, `docs/`) and ran them against the current code through the real CLI (`.venv/bin/isort`) in a clean sandbox. Every finding below was re-verified by hand against the live CLI before being listed. Findings the pipeline attributed to its own test-generation mistakes are excluded.
**Tracker cross-check:** every finding was searched against isort's GitHub issues and PRs (open and closed) on 2026-07-17.

> **Version note.** isort's shipped docs (README, the 5.0.0 upgrade guide, the W0500 warning-code page) describe the isort **5.x** line, but the code under test is the **9.0 development head**. Every divergence below is between those shipped docs and the current code — in each case the doc was simply never updated.

## Summary

4 verified divergences between what isort's documentation states and what the tool does: 2 stale example outputs, 1 documented feature that no longer exists, and 1 documented flag form that silently does nothing. **All 4 appear in no open issue or PR** (one has related historical tracker activity). The guard run additionally raised 5 findings that were test-generation artifacts rather than tool or doc bugs; hand-verification confirmed all 5, and they are excluded from the table below.

## Findings

| # | Finding | Tracker status |
|---|---------|----------------|
| 1 | **The README's headline "Before / After" example doesn't reproduce.** `README.md` (lines 36–76) shows an unsorted file and the sorted result. Running default `isort` on the exact "Before" file produces a *different* "After": `my_lib` sorts *before* `third_party` in one section with **no** separating blank line (the doc shows `third_party` first, a blank line, then `my_lib` as a separate first-party section), and the `third_party` import wraps `lib1–lib9` on the first line at the default 79-char width (the doc shows `lib1–lib8`, i.e. balanced wrapping). The doc's output requires `known_first_party=my_lib` + `balanced_wrapping`, which a plain run does not apply. | Unreported. |
| 2 | **The `-c -v` verify example shows a stale ERROR line.** `README.md` line 259 documents `ERROR: …/isort.py Imports are incorrectly sorted.` The current program emits `ERROR: <path> Imports are incorrectly sorted **and/or formatted.**` The `SUCCESS: … Everything Looks Good!` line still matches. | Unreported. |
| 3 | **The W0500 warning-code page documents a warning system that no longer exists.** `docs/warning_and_error_codes/W0500.md` describes W0501 (deprecated CLI flags ignored), W0502 (flags remapped), W0503 (deprecated config options ignored), and states (line 4) any of these "will trigger one additional warning listing the upgrade guide." No W0501/W0502/W0503 — or any deprecation-warning — code exists anywhere in `isort/`. The page's own canonical W0501 example, `--recursive` (lines 11–12, "can safely be ignored"), instead produces a hard argparse usage error (exit 2; `--recursive` is absent from the usage listing) — neither ignored nor warned about. | Unreported as drift. **Related history:** #1568, #1448, #1447, #1363 all concern the isort-5-era deprecation-warning behavior, which has since been removed without this page being updated. |
| 4 | **A documented `-sl` flag form silently does nothing.** `docs/configuration/multi_line_output_modes.md` line 70 tells users to set `force_single_line` "(`-sl` on the command line)". Passing single-dash `-sl` leaves `from third_party import lib1, lib2, lib3` unchanged; `--sl`, `--force-single-line`, and `force_single_line=true` in config all correctly split each name onto its own line. Single-dash two-letter option names stopped working (the 5.0.0 upgrade guide documents this), but this page still shows the old `-sl` form, and the single-dash form is ignored with no error. | Unreported. *(Surfaced by the auto-resolution safety review, not one of the pipeline's own findings.)* |

Findings 1–2 are stale example outputs; 3 is a doc page for a removed feature; 4 is a documented flag form that no longer functions. In every case the code's behavior looks intentional and the documentation is out of date.

## The pipeline's 8 review findings, verified

The guard run raised 8 findings for human review. Hand-verification against the live CLI confirmed **all 8 triage verdicts**: 3 were genuine documentation drift (findings 1–3 above) and 5 were test-generation artifacts — the generated scenario asserted something the documentation never claims:

- **`-df` (and the other single-dash two-letter flags).** The scenario expected the single-dash form to be *rejected* with exit 2. In reality it is silently reinterpreted as a cluster of single-letter flags (exit 1, "no paths"), which is exactly what the doc's "now require two dashes to avoid ambiguity" wording describes — not a parser rejection. (The genuinely-drifted half of this is finding 4.)
- **multi_line_output 1 (Vertical).** The scenario expected a verbatim round-trip of an illustrative doc snippet containing a `...` ellipsis; isort correctly sorts `...` to the front and normalizes commas, still producing valid Vertical-style output.
- **W0502 (`-ws`) and W0503 (`not_skip`).** The scenarios guessed specific trigger flags/options the W0500 page never names; `-ws` is rejected as unknown and `not_skip` raises `UnsupportedSettings` — neither reaches the (nonexistent) W0502/W0503 path. The real drift here is finding 3.

## Auto-resolution safety check

The run resolved 22 scenarios without human review (7 fidelity-discards + 15 triage-resolves), each on the grounds that the scenario under-tested its claim rather than revealing a bug. To confirm none buried a real divergence, 6 were re-run across both kinds against the live CLI: `--check` (detects both sorted **and** unsorted files), `--atomic` (withholds changes when the output would be invalid), `--profile black` (its settings are actually merged into the effective config), multi_line_output 3 (wraps an over-long line to Vertical Hanging Indent), default direct+aliased retention, and `force_single_line` splitting. **All six behaved exactly as documented** — the auto-resolutions were correct. (This sample is what surfaced finding 4.)

## Tracker cross-check of the target bugs

| Bug | State | In doc-derived scope? | This run |
|-----|-------|-----------------------|----------|
| **#2352** idempotency (direct+aliased import under `--profile black`) | closed / fixed | **No** — idempotency is not a documented guarantee | **RELATED.** Our `keep-direct-and-as` scenario uses the exact same input construct (`from datetime import datetime` + `… as dt`) but asserts only single-pass retention; no scenario is an idempotency invariant. The bug reproduces as **stable** now. isort exercises idempotency internally via a property test (`test_isort_is_idempotent`, #2171). |
| **#2037** `--sort-reexports` is broken | closed / fixed | **Yes** — `sort_reexports` is documented (`options.md`) | **UNREPORTED by our run.** The option is in the documented surface but no scenario exercised it (the reference page states the option, not a runnable outcome). |
| **#1882** invalid syntax for modules that directly import `__future__` | closed / fixed | **Yes** — `__future__` appears in the README example | **RELATED.** Our README-example scenario exercises `__future__` top-placement; the output compiles cleanly. Works now. |

## Coverage note

Four documentation sections were not evaluated this run because the pipeline's fidelity-review call timed out (tool-side, 120 s): `config_files` "supporting multiple config files in a single run", and multi_line_output modes 4, 10, and 11. They are re-attempted automatically on the next run and are not reflected above.

## Notes on interpretation

- The common root cause is that isort's user-facing docs still describe the 5.x line while the code advanced to the 9.0 development head: single-dash two-letter flags stopped working, the W0500 deprecation-warning system was removed, and the verify message gained "and/or formatted". Each doc was simply never updated.
- All four verified findings are documentation bugs, not code bugs — the current behavior is reasonable and intentional; the docs are stale.
- The strongest candidate for upstream filing is finding 3 (an entire doc page for a feature that no longer exists, with the clearest supporting history). Findings 1, 2, and 4 would fit a single documentation PR.
