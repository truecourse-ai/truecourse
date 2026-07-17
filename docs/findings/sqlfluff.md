# sqlfluff — documentation & parser findings

**Target:** [sqlfluff/sqlfluff](https://github.com/sqlfluff/sqlfluff), version 4.2.2 (editable install from source, 2026-07-16)
**Method:** TrueCourse guard (v0.7.3-next.5) generated executable test scenarios from sqlfluff's own documentation (`docsv/`, `README.md`) and ran them against the current code in a clean sandbox. Every finding below was then re-verified by hand against the live CLI before being listed. Findings the pipeline attributed to its own test-generation mistakes are excluded.
**Tracker cross-check:** every finding was searched against sqlfluff's GitHub issues and PRs (open and closed) on 2026-07-17.

## Summary

11 verified divergences between what sqlfluff's documentation states and what the tool does: 8 documentation bugs, 2 parser gaps, 1 minor output nit. Of these, **1 was previously reported** (and fixed only in the legacy docs, not the current ones), **2 touch areas with related tracker activity**, and **8 appear in no issue or PR**.

## Findings

### Documentation vs. behavior

| # | Finding | Tracker status |
|---|---------|----------------|
| 1 | **`sqlfluff fix` walkthrough is stale.** `docsv/guide/basic-usage.md` shows the header `==== finding violations ====`, an interactive `[Y/n]` confirmation prompt, and a final `== [file] PASS`. Current behavior: header reads `finding fixable violations`, no prompt is shown, and the result line is `FIXED`. | **Previously reported.** Umbrella issue #6968; merged PR #7353 fixed this in the legacy `gettingstarted.rst` but the `docsv/` copy still shows the old output. #8044 (closed, unmerged) attempted a related clarification. |
| 2 | **Getting-started lint walkthrough is stale.** `README.md` and `docsv/guide/index.md` show lint output including `LT01 … at end of file` and an `LT12` violation; linting the walkthrough's own input produces neither string. | Related to #6968 / #7353 (same "output changed in v3" root); the lint walkthrough itself was never corrected. |
| 3 | **The docs' own `loader_search_path` example fails.** `docsv/configuration/templating/jinja.md` demonstrates `{% include 'included_templates/my_template.sql' %}`; running it as documented fails with "not found in search path". The path in the example is double-prefixed — `{% include 'my_template.sql' %}` works. | Unreported as a bug. PRs #5930 / #7414 touched the feature but not the broken example. |
| 4 | **Undefined template variables are reported *with* a position.** `docsv/configuration/templating/generic.md` states an undefined variable produces a violation "without a line number". Current behavior reports it with a line and position (e.g. `L:1 | P:11 | TMP | Undefined jinja template variable`). | Unreported. |
| 5 | **Own-line comment alignment is not enforced.** `docsv/configuration/layout.md` (comment indents) states a comment alone on its own line must be aligned with the first code element following it and that unaligned comments are flagged. An own-line comment at column 0 above indented code lints clean (exit 0). | Unreported. |
| 6 | **Block-comment first-line alignment is not enforced.** Same doc section: a block comment whose first line is not aligned with the following code element is documented as a layout violation; it lints clean. | Unreported. |
| 7 | **Unrendered template branches are linted.** `docsv/configuration/layout.md` (templated indents) states code in unrendered template sections "cannot be linted". Placing whitespace violations inside `{% if False %} … {% endif %}` produces LT01 violations on those lines (exit 1). | Unreported. |
| 8 | **LT12 trailing-newline example is stale.** The documented example output for the trailing-newline rule no longer matches what the rule prints. | Unreported (could fall under umbrella #6968). |

### Parser gaps

These were surfaced by generated test inputs, not by the documentation itself; both reproduce with a one-line file.

| # | Finding | Tracker status |
|---|---------|----------------|
| 9 | **`SAVEPOINT` is unparsable in the postgres dialect.** `SAVEPOINT sp1;` — standard PostgreSQL — produces an unparsable-section (PRS) error under `--dialect postgres`. | Unreported. |
| 10 | **T-SQL `]]` bracket escape is unparsable.** `SELECT * FROM [My]]Table];` — the documented T-SQL way to include `]` in a bracketed identifier — fails to parse under `--dialect tsql`. | Unreported. |

### Minor

| # | Finding | Tracker status |
|---|---------|----------------|
| 11 | The completion line is documented as `All Finished 📜 🎉!`; the emoji are emitted only on a TTY, so scripted/CI output reads `All Finished!`. | Unreported. Cosmetic. |

## Notes on interpretation

- Findings 1–8 are documentation bugs: in each case the code's current behavior appears intentional and the documentation is stale or incorrect. They matter because users following the documentation get different results than promised.
- Findings 9–10 are code gaps against the dialects the documentation claims to support. Both were found by generated inputs rather than user reports, which is consistent with their absence from the tracker: no one had filed the exact construct.
- sqlfluff's maintainers track documentation problems primarily through one umbrella issue (#6968) and fix drift opportunistically in PRs, which explains why most per-symptom documentation bugs here have no individual tracker entry.
- The strongest candidates for upstream filing are #9, #10 (concrete, reproducible parser bugs with zero prior coverage) and #7 (an explicit documented claim contradicted by observable behavior). Findings 1–3 and 8 would fit a single documentation PR referencing #6968.
