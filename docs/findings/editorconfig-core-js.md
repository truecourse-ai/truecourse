# editorconfig-core-js — documentation & CLI findings

**Target:** [editorconfig/editorconfig-core-js](https://github.com/editorconfig/editorconfig-core-js), version 3.0.2 (commit `71d4a0a`, built from source, 2026-07-17)
**Method:** TrueCourse guard generated executable test scenarios from the project's own `README.md` — the only CLI-observable section is "in Command Line" — and ran them against the current CLI (`node bin/editorconfig`) in a clean sandbox. Every candidate discrepancy the pipeline set aside was then re-verified by hand against the live CLI. Scenarios the automated review attributed to its own test-generation shortfalls are excluded.
**Tracker cross-check:** the target tracker bugs were searched against editorconfig-core-js's GitHub issues (open and closed) on 2026-07-17.

## Summary

**No verified divergences** between what editorconfig-core-js's documentation states and what the CLI does. All 2 committed scenarios pass against the current code (2 pass, 0 fail, 0 stale, 0 orphaned, 0 error).

The README's only CLI-testable section ("in Command Line") states three CLI claims. The pipeline generated three candidate scenarios for it and kept two. It set aside one as a test-generation mistake (none referred for human review). Hand-checking confirmed it: the documentation and the program agree, and the scenario merely under-tested a claim. It concealed no real divergence.

Tracker classification: **0 exact, 0 related, 0 unreported** — there are no verified findings to file.

## Findings

None. The 2 kept scenarios cover the README's "in Command Line" section:

- **No-argument usage (1 scenario)** — running the binary with no `FILEPATH` prints usage listing the `FILEPATH` argument and the `-v`/`--version`, `-f <path>`, `-b <version>`, `--files`, and `-h`/`--help` options, in that order.
- **Resolved properties (1 scenario)** — running the binary against a file prints the resolved EditorConfig properties (`charset`, `insert_final_newline`, `end_of_line`, `tab_width`, `trim_trailing_whitespace`) as `key=value` lines.

Both were spot-run again by hand and are non-vacuous. The no-argument run exits 1 and prints the full documented option list to stderr in the asserted order (a generic error or truncated usage would fail the ordered pattern). With a `root=true` `.editorconfig` declaring the five properties, `editorconfig anatomy.md` exits 0 and prints exactly `charset=utf-8 / insert_final_newline=true / end_of_line=lf / tab_width=8 / trim_trailing_whitespace=sometimes` — the documented output verbatim.

## Notes on interpretation

- **The one set-aside candidate is a test-generation mistake, not a bug.** The README says `--files` prints the contributing config file names and their globs *instead of the configuration itself*. The dropped scenario's regex only checked that the `.editorconfig [glob]` lines appear in stdout; it never asserted that the `key=value` configuration output is *absent*, so it would stay green even if `--files` additively printed both. It cannot isolate the "instead of" half of the claim. Doc and code do not disagree here — the scenario simply under-tested the claim, so the pipeline discarded it as a generation defect. Because it was classified as a generation defect rather than drift or a human finding, the next `guard generate` re-attempts a discriminating scenario for exactly that facet.

- **A CLI-doc harness reaches very little of this repo's behavior, and the run is honest about it.** editorconfig-core-js is a *library*; the CLI (`bin/editorconfig` → `lib/cli.js`) is a thin wrapper that resolves properties for a file path and prints them. Almost all of the README's behavioral surface is the Node.js library API — `parse`/`parseSync`, `parseBuffer`/`parseString`, `parseFromFiles`/`parseFromFilesSync`, and the `options` object (`config`, `version`, `root`, `files`, `cache`, `unset`). The pipeline marked **14 documented facets `awaiting-driver: library`** (a non-CLI harness is needed) and wrote no scenarios for them; the `development` section is `blocked-on` (needs `npm link` / global install / network) and the remaining sections are non-behavioral prose (intro rationale, install commands, and the `SECURITY.md` policy tables). So the two committed scenarios represent essentially the entire CLI-doc surface of this repo — the README's two `bin/editorconfig` examples — and nothing more.

- **The real EditorConfig contract lives outside this README.** What most people mean by "EditorConfig behavior" — glob/brace-expansion matching, property resolution, `root` handling, spec-version defaults — is defined by the external [editorconfig-spec](https://github.com/editorconfig/editorconfig) and exercised by the shared **CMake conformance suite** (`npm test`), not by this project's README. A README-derived CLI-doc harness cannot reach that surface; it can only confirm that the two documented CLI invocations behave as printed. This is a boundary of the method, not a gap the project should close in its docs.

- **One section failed to author this run for tool-side reasons, not a repo problem.** The README's `# Testing` section hit two transient LLM-call failures during authoring and produced no scenario; `guard generate` re-attempts it on the next run. It describes the CMake / `npm test` conformance harness — a test-infrastructure section, not CLI behavior — so it would fall to the conformance-suite boundary above even once authored.

- **A minor documentation-completeness gap, found by hand (not a behavior divergence).** The live CLI's usage output additionally lists a `--unset` flag ("Remove all properties whose final value is 'unset'") and prints `-v, --version` as "Display version information". The README's CLI usage code block omits `--unset` entirely and shows the `-v` help as "Display version information from the package". The README documents the `unset` *options-object* property in its Options list but never the `--unset` *flag*, so the CLI usage block is slightly behind the actual CLI. The no-argument scenario asserts the presence and order of the documented options rather than the full set, so it stays green; this is a doc-completeness lag worth a README touch-up, not a bug.

- **All three target tracker bugs are out of CLI-doc scope.** #118, #92, and #86 are all **closed**, and all three are glob/path-matching-semantics defects, not CLI-documentation defects:
  - **#118** (brace syntax: a slash in one alternative, e.g. `[{*.ext,foo/bar}]`, breaks matching of the other alternatives) and **#92** (single-alternative brace expansion `[*.{js}]` failing to match) are section-name glob-matching bugs.
  - **#86** (config resolution broken for paths containing literal `[` characters) is a path-vs-glob escaping bug in traversal.
  These behaviors are governed by the external EditorConfig spec and its conformance suite, not by anything the README states as CLI-checkable output. They live entirely inside the library/glob-matching surface that a README-derived CLI-doc harness cannot reach, so none matches — or could match — the doc-derived scenarios. **0 exact, 0 related, 0 unreported.**
