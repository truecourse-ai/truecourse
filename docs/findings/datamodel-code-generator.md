# datamodel-code-generator — 8 documentation contradictions; full analysis stopped (corpus size)

**Target:** [koxudaxi/datamodel-code-generator](https://github.com/koxudaxi/datamodel-code-generator), cloned 2026-07-17 (depth 50)
**Method:** TrueCourse guard (v0.7.3-next.8 → next.10) — documentation scan, then scenario generation. The scan completed; scenario generation was **not completed** (see "Why analysis stopped").
**Tracker cross-check date:** not performed for these findings (see note below).

## Summary

The documentation scan surfaced **8 verified contradictions between the repo's own documentation files** — places where two documents describe the same CLI option with incompatible semantics. These were flagged automatically by cross-reading same-topic documents and confirmed by reading the cited passages; each names the exact files and disputed sentences. No documentation-vs-code findings are reported, because scenario generation never completed.

## Findings — documentation-vs-documentation contradictions

All pairs involve `skills/datamodel-code-generator/references/cli-options.md` (auto-generated from the argparse definitions) against a hand-written page under `docs/cli-reference/`. In each conflict the auto-generated page was judged the accurate side (it matches the argparse metadata; several hand-written pages contradict their own worked examples).

| # | Option / topic | Contradiction |
|---|---|---|
| 1 | `--force-optional` | `cli-options.md` says it affects only required fields; `model-customization.md` says it forces **all** fields optional regardless of required status. |
| 2 | `--strip-default-none` | `cli-options.md`: strips the default `None` from fields; `model-customization.md`: removes the fields entirely. |
| 3 | `--reuse-scope` | Choices given as `module`/`tree` in one document, `root`/`tree` in the other. |
| 4 | Parent-prefixed naming | Underscore form (`Company_Address`) vs CamelCase concatenation (`OrderItem`) for the same feature. |
| 5 | `--openapi-scopes` | Six documented choices (`schemas, paths, tags, parameters, webhooks, requestbodies`) vs three (`schemas, paths, parameters`) — the three-choice list appears in two separate pages (both flagged). |
| 6 | `--ignore-enum-constraints` | Base-type wording differs: "base string or int type" vs "base string type" specifically. |
| 7 | `--save`/install guidance and base-options wording | `base-options.md` vs `faq.md` / `cli-options.md` disagree on option descriptions in the base-options family. |
| 8 | General options wording | `general-options.md` vs `cli-options.md` describe the same options with diverging semantics. |

A user reading only the hand-written reference pages receives incorrect information about at least items 1–5; the worked examples inside those same pages contradict their own prose in items 1, 2, and 4.

**Tracker note:** these 8 findings were not individually cross-checked against the project's issue tracker; the classification (reported/unreported) is unknown. They are directly verifiable by reading the two cited files for each item.

## Why analysis stopped

The repo's documentation corpus is very large: 960 sections across the docs tree, an estimated ~1,700 model calls for full scenario generation (cost ceiling ~$620 at list prices). Two generation attempts were truncated mid-run when the analysis account hit its usage limits (the second completed 147 of the planned calls, ~$95). 43 of 960 sections settled; no scenarios were committed. The analysis was stopped rather than repeated. A complete run would require either a larger usage budget or scoping the scan to a subset of the documentation tree.
