# Black — documentation & behavior findings

**Target:** [psf/black](https://github.com/psf/black), version `0.1.dev50+g51abf5308` (editable install from source at commit `51abf5308`, 2026-07-12)
**Method:** TrueCourse guard generated executable test scenarios from Black's own documentation (`docs/`, `README.md`) and ran them against the current code through the real CLI (`.venv/bin/black`) in a clean sandbox. Every finding below was re-verified by hand against the live CLI before being listed. Findings the pipeline attributed to its own test-generation mistakes are excluded.
**Tracker cross-check:** every finding was searched against Black's GitHub issues and PRs (open and closed) on 2026-07-17.

> **Scope note.** Both verified divergences are in Black's **preview-style** documentation (`docs/the_black_code_style/future_style.md`) — the page describing features gated behind `--preview`. Black's stability policy treats preview features as experimental and expects their docs to churn, so neither finding touches Black's stable-style guarantees. In each case the *code* behaves reasonably and intentionally; the preview doc's example or wording is what's inaccurate.

## Summary

2 verified divergences between what Black's preview-style docs show and what the tool does: 1 pair of stale "After" example outputs, and 1 feature-list bullet whose wording is broader than the implementation. **Both appear in no open or closed issue or PR.** The guard run additionally raised 10 findings that were test-generation or harness artifacts rather than tool or doc bugs; hand-verification against the live CLI confirmed all 10, and they are excluded from the table below.

## Findings

| # | Finding | Tracker status |
|---|---------|----------------|
| 1 | **The preview `hug_comparator` `if`/`assert` examples don't reproduce.** `docs/the_black_code_style/future_style.md` ("Keep comparators next to their left operand", lines ~357–393) shows two `# Before → # After (with --preview)` pairs — an `if` chain and an `assert` — in which the right-hand bracket explodes across multiple lines with a trailing comma. Feeding those exact "Before" inputs through `black --preview` keeps each bracketed operand on **one** line instead: `and self.dtype in (np.dtype("float64"), np.dtype("float32"), np.dtype("object"))` and `bool is _AnnotationExtractor(attr.fields(C).x.converter.__call__).get_return_type()` both fit within the 88-column limit and carry no magic trailing comma, so nothing has to break. The feature itself works — the comparator stays attached to its left operand, and the section's *comprehension* example (which does have a magic trailing comma) reproduces exactly — but the two rendered `if`/`assert` "After" blocks show an explosion the formatter does not produce. | Unreported. |
| 2 | **The `parenthesize_tuple_in_yield` bullet over-states its scope.** `future_style.md` line 44 lists the preview feature as "Add parentheses around tuple expressions in `yield` statements." Under `--preview`, an ordinary multi-element `yield 1, 2` is left **unchanged**; only a *singleton* one-tuple `yield x,` becomes `yield (x,)`. Black's own test fixture (`tests/data/cases/yield_singleton_tuple.py`) and the PR that added the feature (#5170, titled "Parenthesize **singleton** tuples in yield expressions") confirm the singleton-only scope. The bullet's wording ("tuple expressions") reads as covering all tuples; the doc never says "singleton". | Unreported. |

Finding 1 is a pair of stale illustrative outputs; finding 2 is imprecise feature wording. In both cases the code's behavior looks intentional and the preview documentation is what's slightly off.

## The pipeline's 12 review findings, verified

The guard run raised 12 findings for human review. Hand-verification against the live CLI confirmed **all 12 triage verdicts**: 3 were genuine documentation drift (they fold into findings 1–2 above) and 9 were test-generation or harness artifacts — the scenario under-tested its claim, tested an external tool it cannot drive, or the harness mis-captured output.

Genuine drift (→ findings above):

- **`hug_comparator` inside an `if` chain** and **inside an `assert`** — the two scenarios asserted the doc's exact exploded "After" blocks; Black keeps both on one line (finding 1).
- **`yield 1, 2` under `--preview`** — the scenario expected `yield (1, 2)`; Black leaves it unchanged because the feature is singleton-only (finding 2).

Test-generation / harness artifacts (documented Black behavior itself holds, verified live):

- **`--diff --color`** — the scenario's recorded output had no ANSI codes, but the live CLI *does* emit them (`^[[1m`, `^[[31m`, `^[[32m` via `cat -v`); the sandbox capture stripped the control chars. Doc is correct.
- **`simplify_power_operator_hugging`** — scenario tested only single-line `x ** 2 → x**2`; verified the `**`-hugging also applies to the multi-line split case. Claim holds.
- **"Black only supports TOML config"** — scenario didn't test exclusivity; verified a `setup.cfg` `[tool:black]` block is ignored. Claim holds.
- **pycodestyle E701/E704 stub** — scenario only checked Black collapses `def f(): ...`; it cannot invoke pycodestyle, which is what the claim is about. Black-side collapse verified.
- **`black -` reformatted summary** — scenario asserted only `reformatted -`, not the quoted `1 file reformatted.`; verified both lines print.
- **`--no-cache`** — scenario checked only that no cache dir is written (verified: with `--no-cache` the `BLACK_CACHE_DIR` dir is not created, and without it, it is); the "does not *read*" half was untested.
- **`--check` internal-error exit 123** — scenario triggered a syntax error, not an internal AST-equivalence error; verified the syntax-error path exits 123 with `1 file would fail to reformat.`.
- **pyproject lookup hierarchy** — scenario tested only that `pyproject.toml` overrides the default (verified: `line-length = 10` wraps a call); the "CLI overrides both" half was untested.
- **Docker `black --check .` exit code** — scenario checked only the trivial exit-0 case and needs the Docker image (untestable via the local CLI); the underlying `--check` exit codes are verified by other passing scenarios.

## Auto-resolution safety check

The run resolved 8 scenarios without human review, all fidelity-discards on the grounds that the scenario under-tested its claim (6 were pycodestyle/pylint-compatibility claims that can only be checked by running those external tools, not Black; 2 were summary-line under-assertions). To confirm none buried a real divergence, 5 were re-run against the live CLI: **E203 slice spacing** (`ham[lower + offset : upper + offset]` — Black does put spaces around the slice colon), **`class C: ...` stub collapse**, the **`--diff` `1 file would be reformatted.` summary**, the **`black -` `1 file reformatted.` summary**, and the **default 88-column line length** (the `--line-length` mechanism wraps over-limit lines and leaves shorter ones alone). **All five behaved exactly as documented** — the auto-resolutions were correct.

## Tracker cross-check of the target bugs

| Bug | State | In doc-derived scope? | This run |
|-----|-------|-----------------------|----------|
| **Finding 1** `hug_comparator` `if`/`assert` example drift | — | **Yes** — the "After" blocks are in the preview docs | **UNREPORTED.** No issue or PR mentions it. Introduced with the feature (PR #5135, "Don't break before a comparator when the RHS bracket explodes"); the hand-written examples over-explode relative to the shipped behavior. |
| **Finding 2** `parenthesize_tuple_in_yield` wording | — | **Yes** — the bullet is in the preview docs | **UNREPORTED.** No issue or PR. The feature (PR #5170) was always singleton-only; the doc bullet's wording was never narrowed to match. |
| **#5225** `# fmt: off` changes blank-line count before a class | open (`T: bug`, `F: fmtoff`) | **Related, not tested** — the 2-blank-lines-around-definitions rule it violates is documented in `current_style.md`, and `# fmt: off` is documented, but only as an edge interaction | **RELATED / UNREPORTED by our run.** No scenario exercised `# fmt: off` or blank-lines-around-a-class, so the run did not surface it. It reproduces as a live **code** bug (not a doc drift), outside the doc-promise surface our scan tests. |

## Coverage note

This was a throttled run. Of Black's 119 documentation sections, 51 got executable scenarios (all 51 pass) and 8 were auto-resolved; **33 sections could not be settled** because the pipeline's own LLM review/authoring calls were throttled by concurrent runs (tool-side `claude exited 1` timeouts — 52 fidelity-review and 12 authoring casualties). Those sections are re-attempted automatically on the next run and are not reflected above. A further set of sections (e.g. the `contributing/` "gauging changes" guidance) state no externally-observable behavior and are untestable by design.

## Notes on interpretation

- Both verified findings are **documentation** issues, not code bugs — the current behavior is reasonable and intentional; the preview docs are what's stale or loosely worded.
- Both live entirely in `future_style.md`, the preview-style page. This is exactly where Black's `--preview` churn concentrates: examples get hand-written as features land, and one feature's wording (`parenthesize_tuple_in_yield`) outran its singleton-only implementation. Neither affects Black's stable-style stability guarantees.
- The two findings would fit a single small documentation PR against `future_style.md`: re-render the `hug_comparator` `if`/`assert` "After" examples to match the compact output, and narrow the `parenthesize_tuple_in_yield` bullet to say "singleton tuples".
