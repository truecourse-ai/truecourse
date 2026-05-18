# 08. CLI Command Extraction

`STATUS: DONE`

## Scope

Add first-class deterministic spec-compliance facts and matchers for CLI command surfaces.

## Delivered

- [x] Added `cli` as a requirement kind.
- [x] Extracted `cli.binary` facts from package `bin` metadata using a separate `package-cli-extractor`.
- [x] Extracted Commander `cli.binary`, `cli.command`, `cli.option`, and `cli.argument` facts from static TypeScript/JavaScript call chains.
- [x] Matched CLI binary, command, option, and argument requirements with dedicated deterministic matchers.
- [x] Reported unmatched CLI binaries and commands as unspecified implementation findings while suppressing option/argument noise.
- [x] Added analyzer, matcher, and end-to-end fixture coverage.

## V1 Limits

- Commander only.
- TypeScript and JavaScript only.
- Static string literals and values handled by the existing static resolver only.
- Dynamic command names, runtime loops, spread option definitions, yargs/cac, and cross-file command tree mutation are skipped.
