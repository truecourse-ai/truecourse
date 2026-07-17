# markdown-it-py — documentation & CLI findings

**Target:** [executablebooks/markdown-it-py](https://github.com/executablebooks/markdown-it-py), version 4.2.0 (branch `master`, commit `bff75ed`, built from source into a fresh virtualenv via `pip install -e .`, 2026-07-16)
**Method:** TrueCourse guard generated executable test scenarios from markdown-it-py's own documentation — the "Command-line Usage" section of `README.md` — and ran them against the installed CLI (`.venv/bin/markdown-it`) in a clean sandbox. Every scenario's expectation was then spot-checked by hand against the live CLI.
**Tracker cross-check:** the three target-list bugs (#351, #377, #376) were read against markdown-it-py's GitHub issues on 2026-07-16 to check whether the repo's own documentation promises anything a doc-derived scenario could have caught.

## Summary

**No verified divergences** between what markdown-it-py's documentation states and what the CLI does. All 8 committed scenarios pass against the current code (run reported 8 pass, 0 fail, 0 stale, 0 orphaned, 0 error).

The pipeline surfaced no candidate discrepancies — 0 birth findings, 0 errors, 0 extraction failures. There is nothing to file.

**Coverage is deliberately thin, and honestly so.** markdown-it-py is a Python markdown-parsing *library* that ships a thin CLI wrapper. Of its 30 documented sections, exactly one — the README's "Command-line Usage" block — states behavior a command-line test harness can drive; it is fully covered by the 8 scenarios. The remaining 29 sections produced 48 claim-level coverage gaps: **34 need a library driver** (the Python API — `md.render`/`md.parse`, the `commonmark`/`zero`/`gfm-like` presets, the token stream, custom renderers, plugins, URI-scheme security filtering, CommonMark baseline compliance), **11 are untestable prose** (acknowledgments, the benchmark table, architecture narration, `pip`/`conda` install commands), and **3 state no assertable claim**. None of these are reachable by a CLI harness, which is why the tested surface is small. This run exercised the whole of what the CLI documents, not a sample of it.

## Findings

None. The 8 kept scenarios all bind to `README.md` → "Command-line Usage" and cover every observable behavior that section documents:

- `markdown-it -h` / `--help` — prints the usage text (`usage: markdown-it … Parse one or more markdown files … -h, --help  show this help message and exit`) and exits 0 (2 scenarios).
- `markdown-it -v` / `--version` — prints the program's version number and exits 0 (2 scenarios).
- `markdown-it --stdin` — reads markdown from standard input and renders it to HTML (1 scenario; feeds `# Example` / `> markdown *input*`, asserts the `<h1>`/`<blockquote>` output shown in the README's interactive example).
- one filename, several filenames, and the batch form (`markdown-it README.md README.footer.md`) — each file is parsed, converted to HTML, and printed to stdout in order (3 scenarios).

Each documented behavior matched the live CLI.

## Notes on interpretation

- **Live spot-checks confirmed the pass result is not vacuous.** Three scenarios were re-run by hand against `.venv/bin/markdown-it`: `--help` printed the usage block and exited 0; `--stdin` fed `# Example\n> markdown *input*` produced exactly `<h1>Example</h1>\n<blockquote>\n<p>markdown <em>input</em></p>\n</blockquote>`; and `-v` printed `markdown-it-py [version 4.2.0]` (matching the `\d+\.\d+` assertion). All three behaved as the scenarios assert.

- **The three tracker bugs are all library-level parsing/spec-compliance defects, outside what the CLI docs promise.** None could ever be caught by a scenario derived from the "Command-line Usage" section, which describes flags and the file→HTML→stdout plumbing — not CommonMark or GFM parsing rules:
  - **#351** (closed, *"Does not match last Commonmark specs (0.31.2)"*) — 6 CommonMark 0.31.2 conformance cases fail. The README does claim markdown-it-py "Follows the CommonMark spec for baseline parsing," and `docs/using.md` documents the `commonmark` preset as strictly compliant — but those are **library** claims about `md.parse`/`md.render`, which this run recorded as `awaiting-driver: library` gaps. Even a library-driver scenario would need the specific spec version and failing cases the docs never enumerate; the docs promise generic baseline compliance, not a pinned conformance suite.
  - **#377** (open, HTML comment block ended before `-->`) — a CommonMark HTML-block tokenization bug in `md.render` output. Library-level; the docs state nothing about HTML-comment termination.
  - **#376** (open, table parsing absorbs a trailing paragraph) — a GFM table rule bug reached only via `MarkdownIt('commonmark').enable('table')`, a Python-API extension the CLI does not expose. Library-level.

  All three sit inside the 34 library-driver gaps this CLI-only harness cannot reach. There is no overlap between them and the 8 passing scenarios, and none represents a gap those scenarios failed to catch — they are simply outside the CLI's documented surface.

- **One cosmetic doc drift, explicitly not counted as a finding.** The `usage:` block transcribed into `README.md` has drifted slightly from the CLI's live `--help`: the README lists `--stdin` under "positional arguments" and labels the group "optional arguments:", while the live CLI lists `--stdin` under "options:" and phrases it "read Markdown from standard input" (README: "read source Markdown file from standard input"). This is a hand-copied help snippet lagging the code, not a behavioral divergence — the generated scenarios assert observed behavior (which is correct) rather than the exact transcribed text, so they pass. Recorded here for transparency only; it is not a verified defect.
