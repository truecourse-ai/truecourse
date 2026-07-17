# marked — documentation & CLI findings

**Target:** [markedjs/marked](https://github.com/markedjs/marked), version 18.0.6 (commit `9154f8f`, built from source, 2026-07-16)
**Method:** TrueCourse guard generated executable test scenarios from marked's own documentation — the OPTIONS section of `man/marked.1.md` and the Usage block of `README.md` — and ran them against the current CLI (`node bin/marked.js`) in a clean sandbox. Every candidate discrepancy below was then re-verified by hand against the live CLI. Scenarios the automated review attributed to its own test-generation shortfalls are excluded.
**Tracker cross-check:** every candidate was searched against marked's GitHub issues and PRs (open and closed) on 2026-07-16.

## Summary

**No verified divergences** between what marked's documentation states and what the CLI does. All 19 committed scenarios pass against the current code.

The pipeline surfaced four candidate discrepancies — one referred for human review, three set aside by the automated review. Hand-checking confirmed all four are test-generation mistakes, not code or documentation defects: in each case the documentation and the program agree, and the scenario either tested an unrelated behavior or exercised only one half of a two-sided claim. None concealed a real divergence.

Tracker classification: **0 exact, 0 related, 0 unreported** — there are no verified findings to file.

## Findings

None. The 19 kept scenarios cover the CLI OPTIONS section of `man/marked.1.md` (17 scenarios: `-o/--output`, `-i/--input`, `-s/--string`, `-c/--config`, `-t/--tokens`, `-n/--no-clobber`, `--pedantic`, `--gfm`, `-h/--help`) and the Usage block of `README.md` (2 scenarios: `marked -o hello.html` with stdin writing `<p>hello world</p>`, and `marked --help` printing the option list). Each documented behavior matched the live CLI; the run reported 19 pass, 0 fail, 0 stale, 0 orphaned, 0 error.

## Notes on interpretation

- **The one candidate referred for human review is a test-generation mistake, not a bug.** The scenario bound to the `--silent` line of `man/marked.1.md` (`* --silent` / `Silence error output.`) and asserted that `marked --silent -i missing.md` writes nothing to stderr. In fact it writes `marked: missing.md: No such file or directory` and exits 1 — but so does the identical run *without* `--silent`:

  ```
  node bin/marked.js --silent -i missing.md   # stderr: marked: missing.md: No such file or directory  (exit 1)
  node bin/marked.js -i missing.md            # identical — --silent changed nothing
  ```

  The `--silent` flag maps to marked's library `silent` option, which governs *markdown parse/render* errors; the missing-file error is an `ENOENT` raised while reading the input, before any parsing, and is reported by the CLI's top-level error handler regardless of the flag. The scenario chose an error source `--silent` never governed, so it does not demonstrate any documentation-vs-code disagreement. (A doc owner could optionally tighten the terse `Silence error output.` line to name the error class it actually covers, but that is a wording preference, not a verified defect, and it is not listed as one here.)

- **Three further candidates were set aside by the automated review as test-generation mistakes, and hand-checking confirmed each.** All three concern option flags whose documented behavior the live CLI honors:
  - `--gfm` renders a GFM table: because GFM is on by default, `<table>` is produced with or without the flag, so the scenario's `<table>` assertion cannot isolate `--gfm`. `--no-gfm` correctly suppresses the table. Documentation and behavior agree that GFM parsing is on when `--gfm` is passed.
  - `--breaks` producing `<br>` when combined with `--gfm`, and `--breaks` having no effect under `--no-gfm`, were each tested on only one side. Both sides behave as documented (`man/marked.1.md`: "Enable GFM line breaks. Only works with the gfm option."):

    ```
    printf 'hello\nworld' | node bin/marked.js --gfm --breaks     # <p>hello<br>world</p>
    printf 'hello\nworld' | node bin/marked.js --no-gfm --breaks  # <p>hello\nworld</p>  (no <br>)
    ```

- **The scenarios are bounded by what the docs state as CLI-checkable behavior.** Three tracker bugs in this project — #3996 (open: architectural deviations from the CommonMark spec, e.g. autolink/email escaping and emphasis delimiter handling), #4002 (closed/completed: an ordered list immediately after a blockquote is wrongly nested inside it), and #4011 (closed/completed: an inline code span after a literal tilde has its backticks shifted) — are all markdown parsing/tokenization defects. The documentation the scenarios bind to (the CLI OPTIONS section and the README Usage/security-warning block) describes command-line flags and a no-sanitize warning, not CommonMark-level parsing rules for lists, blockquotes, emphasis, or inline code. These bugs are outside what the docs state, not gaps the generated scenarios failed to catch.
