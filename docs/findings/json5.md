# json5 — documentation & CLI findings

**Target:** [json5/json5](https://github.com/json5/json5), version 2.2.3 (commit `b935d4a`, built from source, 2026-07-17)
**Method:** TrueCourse guard generated executable test scenarios from json5's own `README.md` — the "Summary of features", "ECMAScript compatibility", and "CLI" sections — and ran them against the current CLI (`node lib/cli.js`) in a clean sandbox. Every candidate discrepancy the pipeline set aside was then re-verified by hand against the live CLI. Scenarios the automated review attributed to its own test-generation shortfalls are excluded.
**Tracker cross-check:** the target tracker bugs were searched against json5's GitHub issues (open and closed) on 2026-07-17.

## Summary

**No verified divergences** between what json5's documentation states and what the CLI does. All 21 committed scenarios pass against the current code (21 pass, 0 fail, 0 stale, 0 orphaned, 0 error).

The pipeline generated 24 candidate scenarios and kept 21. It set aside three as test-generation mistakes (none referred for human review). Hand-checking confirmed all three: in each case the documentation and the program agree, and the scenario merely under-tested a claim or could not isolate the behavior it named. None concealed a real divergence.

Tracker classification: **0 exact, 0 related, 0 unreported** — there are no verified findings to file.

## Findings

None. The 21 kept scenarios cover:

- **Summary of features (11 scenarios)** — single trailing commas in objects and arrays; unquoted ES5 IdentifierName object keys; single-quoted strings and character escapes; single- and multi-line comments; hexadecimal numbers, leading/trailing decimal points, `Infinity`/`-Infinity`/`NaN`, and explicit-plus-sign numbers; and the extra white-space characters JSON5 permits.
- **ECMAScript compatibility (1 scenario)** — unescaped U+2028 line and U+2029 paragraph separators inside strings.
- **CLI (9 scenarios)** — the `json5 <file>` conversion; STDIN input when no `<file>` is given; and the documented Options: `-s`/`--space` (spaces and `t` for tabs), `-o`/`--out-file`, and `-v`/`--validate`.

Each documented behavior matched the live CLI. Two of these scenarios were spot-run again by hand: converting a JSON5 document with comments, unquoted keys, and trailing commas produced exactly `{"unquoted":"and you can quote me on that","trailingComma":"in objects","andIn":["arrays"]}` (exit 0), and `-s 2` indented `{a: 1}` to a 2-space-indented JSON object (exit 0).

## Notes on interpretation

- **The three set-aside candidates are test-generation mistakes, not bugs — each underlying documented behavior was hand-verified to work.**
  - *Invalid-input `--validate` (fidelity discard).* The scenario asserted that `--validate` on invalid JSON5 exits 1 with no JSON. It does — `echo '{' | json5 --validate` exits 1 with `JSON5: invalid end of input at 1:2`. But the *same* invalid input exits 1 with the identical error *without* the flag (the parse fails either way), so the scenario would stay green even if `--validate` were removed. It cannot isolate the flag; the flag's real behavior is correct.
  - *Multi-line strings via escaped newlines (under-tested).* The scenario only checked that a backslash-newline string is accepted, never that the newline is consumed. Running it: `{a: 'line1\⏎line2'}` converts to `{"a":"line1line2"}` — the backslash-newline is consumed exactly as documented. The dropped scenario simply asserted too little.
  - *`-v` accepts valid input silently (one-sided).* The scenario tested only the "no output" half. In fact `-v` accepts valid input silently (exit 0, empty output) *and* rejects invalid input (`{a:` exits 1 with `JSON5: invalid end of input`), so a no-op flag would not pass a complete test. Both halves behave as documented.

- **Two sections are partially guarded, and the run is honest about it.** `.../cli/usage/options` (3 documented CLI claims) and `.../summary-of-features/strings` (3 claims) each lost one facet to the discards above: the invalid-input rejection side of `--validate`, and the escaped-newline-consumption side of multi-line strings. Those two facets currently have no surviving scenario even though every kept scenario is green. Because both drops were classified as generation defects rather than drift or human findings, the next `guard generate` re-attempts them — it will try again to author discriminating scenarios for exactly those two claims.

- **The scenarios are bounded by what the docs state as CLI-checkable behavior.** The CLI only parses JSON5 and emits standard JSON (`lib/cli.js` does `JSON5.parse` then `JSON.stringify`); it never calls `JSON5.stringify`. The README's library API — `JSON5.parse`/`JSON5.stringify`, the `require('.json5')` loader hook, and the browser UMD global — is documented but has no CLI surface, so the pipeline marked those 9 sections `awaiting-driver` (a non-CLI harness is needed) and wrote no scenarios for them; the remaining uncovered sections are non-behavioral prose (marketing intro, install commands, license, cross-references). The two target tracker bugs both fall inside that library-only area:
  - **#67** (closed: `JSON5.stringify` emits `null` for non-finite values like `Infinity`/`NaN`) and **#273** (closed: `JSON5.stringify` should throw when serializing a `BigInt`) are both `JSON5.stringify` serialization defects — not part of the CLI surface the scenarios exercise. #67 concerns the *stringify* direction; our `numbers.3` scenario touches `Infinity`/`-Infinity`/`NaN` only on the *parse/validate* direction (reading them from JSON5 input), the opposite path, and it passes. The CLI's own JSON output uses `JSON.stringify`, for which `Infinity → null` is correct JSON. So neither bug is in scope of the doc-derived CLI scenarios, and neither matches anything tested.
