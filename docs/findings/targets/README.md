# Strapi, Documenso and Cal.diy: what the guard found, reviewed failure by failure (August 2026)

Three SaaS products were run through the guard pipeline (spec scan of the product's own published docs, scenario generation, guard run against a live instance) on 2026-08-13 and 2026-08-14. Every failing scenario was then reviewed one at a time: read the evidence bundle, find the doc sentence, root-cause it in the tested source, git-blame the culprit, search the upstream tracker (issues and PRs, open and closed), and check whether a later commit on the upstream default branch fixes it. This document is the result. It exists to answer one question with evidence a maintainer can check: does pointing this pipeline at a real product surface real, novel, actionable defects, or noise?

Verdict vocabulary used throughout: **real defect** (the product does not do what its docs or its own schema say, and a user following the docs is harmed), **doc bug** (the product is sane and intentional, the doc text is wrong), **test defect** (the generated scenario asserted something the doc does not promise), **environment** (the sandbox, not the product or the test).

## Scoreboard

| Target | Build tested | Run | Failures reviewed | Real defects (distinct) | Doc bugs (distinct) | Noise (test + env) | Unreported upstream | Known upstream, unmerged | Fixed after the tested build |
|---|---|---|---|---|---|---|---|---|---|
| Strapi | 5.52.0, `develop` @ `c43e9ee1e2` (2026-08-13) | 81 scenarios, 62 pass, 19 fail | 19 | **10** | **7** | 4 (2 test, 2 env) | 17 of 17 | 0 | 0 (develop @ `acf0ce2034`, 2026-08-14) |
| Documenso | 2.16.0 (`3cf2963`, 2026-07-21) | 49 scenarios, 31 pass, 18 fail | 18 | **9** | **7** | 2 (test) | 9 of 16 | 6 (community docs stack #3133 to #3139, and #3136) | 1 (rate limit, PR #3081, 52 min after the tag) |
| Cal.diy | `calcom/cal.diy` `main` @ `038381aeca` (2026-07-31) | 101 scenarios, 21 pass, 77 fail, 3 error | 80 | **13** | **3** | 34 (26 test, 8 env), plus 30 edition mismatches (docs describe Cal.com features or API versions Cal.diy does not ship) | 15 of 16 | 0 | 1 (phone prefill, PR #29740, 5 days after the tested commit, in no tag) |

"Distinct" counts one defect once even when several scenarios hit it (Strapi's two "Delete document" label scenarios are one doc bug) and counts the extra defects a single long scenario exposed (Strapi's relation scenario shows three). The scenario tables below list every failure.

What the numbers say. Strapi and Documenso: **31 of the 37 failures reviewed are the product's or the docs' fault, 6 are noise.** They collapse to 33 distinct findings (19 real defects, 14 doc bugs); 26 had no upstream report at all, 6 had been independently noticed by one Documenso community contributor whose docs PRs sit unmerged, and exactly one has an upstream fix, which landed 52 minutes after the release we tested. Cal.diy is a different picture and an honest one: **16 of 80 failures are product or doc findings (13 defects, 3 doc bugs, 15 of them unreported, one fixed upstream 5 days after the tested build), 30 are the docs describing the commercial product rather than the open-source fork, and 34 are noise from the run itself** (a saturated sandbox and a generator that hardcodes slot times on one shared host). Every one of the researcher's 16 itemized Strapi and Documenso findings was confirmed at source level; of their 5 Cal.com items, 4 were confirmed (two with narrower scope) and 1 was refuted (documented default behavior, maintainers declined to change it). Beyond the write-ups, the review surfaced 14 more distinct real defects and doc bugs on Strapi and Documenso, and 12 more on Cal.diy. Across the three products: 49 findings (32 real defects, 17 doc bugs), 41 with no upstream report, 2 fixed after the build we tested.

## Method and limits

- Verdicts come from the evidence bundle (request, response, transcript, screenshots, server logs), the bound doc page, and reading the tested source; not from a live re-run. Where evidence did not settle it, the reviewer said so rather than guessing.
- "Fixed after" was checked against the upstream default branch fetched 2026-08-15 (`strapi/strapi` `develop` @ `acf0ce2034`, `documenso/documenso` `main` @ `688ef2fdf3`, `calcom/cal.diy` `main` @ `176037d0af`) and against tags.
- Tracker searches were bounded (three per failure); "none found" means those searches, with the queries recorded in the per-failure result files.
- The per-failure JSON results (verdict, quotes, file:line, blame, tracker items, queries) are the source for every row above; they are kept next to this file under `docs/findings/targets/<repo>/<scenario-id>.json`, with the review brief the reviewers worked from as `REVIEW-BRIEF.md` in the same folder.

---

# Filing package

Re-verified 2026-08-19, before anything is filed upstream. This folder is the output of `REVERIFY-PLAN.md`. **Nothing here has been filed. Nothing is filed without human approval.**

## What is here

- **`FILING-GUIDE.md` - read this before filing anything.** The per-repo issue-template requirements, the bot behavior that auto-closes a wrongly formatted issue, the label convention, the evidence/transcript policy, and the exact filing commands.
- `FILING-TABLE.md` - one row per finding (49 distinct findings, ids S1-S17 / D1-D17 / C1-C16 from the per-target `report.md` files): still present on the default branch today, live re-run verdict, new upstream reports since 2026-08-15, route, confidence, draft file. Per-finding filer notes follow the table. **Generated**; edit the sources, not the file.
- `issues/<target>/<ID>-<slug>.md` - one drafted issue (or PR comment, or security report) per filable finding, ready to paste or `gh issue create --body-file`. Each has a front-matter block (`finding`, `target`, `route`, `title`, `labels`, `status: draft`, `reverified`) that is not part of the pasted body.
- `reverify/<repo>/<ID>.json` - the step 1+2 re-check per finding (source state today, doc state today, tracker dedupe, cited-item state, route + policy basis). `reverify/<repo>/POLICY.md` - each repo's security policy, CONTRIBUTING and issue-template requirements, quoted.
- `live/<repo>/` - the step 3 live re-run: a fresh instance built from today's default branch, the scenario replayed by hand, evidence captured. `live/<repo>/REPORT.md` + `summary.json` summarize; per-finding `<ID>/repro.md` hold the requests, responses and screenshots.
- `FINDINGS-INDEX.json` - the machine index tying finding ids to scenarios, review JSONs, culprit files and the live-required set.
- `STATE.md` - clone heads, tags, local services, and the running log with the route changes the re-verify surfaced.
- `tools/build-table.py` - regenerates `FILING-TABLE.md` from the JSONs, the live summaries and the drafts' front matter. Run from this folder's parent (`docs/findings/targets/`): `python3 tools/build-table.py`.

## Route summary (49 findings)

| route | count | findings |
|---|---|---|
| Public issue | 31 | Strapi S1-S5, S7-S10; Documenso D2b, D3, D4, D5, D7, D8, D9, D10, D15, D16; Cal.diy C1, C2, C3, C5, C6, C7, C8, C10, C11, C13, C14+C15 (one issue) |
| Docs repo issue | 7 | Strapi S11 (doc half), S12, S13, S14, S15, S16 -> strapi/documentation; Cal.diy C16 -> calcom/help |
| Security disclosure (private) | 5 | Strapi S6, S11 (escalation half) -> GHSA; Documenso D1 -> GHSA/email; Cal.diy C4, C9 -> advisory + security@cal.com |
| Comment on an existing open PR | 4 | Documenso D2a, D11, D12 -> PR #3136 (D11+D12 one comment); D14 -> PR #3137 |
| Skip | 5 | S17 (environment artifact), D6 (fixed, released v2.17.0), D13 (fixed, released v2.17.0), D17 (test defect), C12 (fixed on cal.diy main, in no tag) |

S11 and S6 both touch a security boundary; S11 is two drafts (a strapi/documentation doc issue for the wrong "shown only once" text, and a GHSA report for the key-readback escalation the live run confirmed).

## What the re-verify changed versus the report

- **Documenso D13 is now fixed and released.** PR #3135 merged 2026-08-19 into main = tag v2.17.0; the get-many body is corrected on docs.documenso.com. The report had `fixedAfter: no`. Skip.
- **Documenso D6 is now in a release.** PR #3081 (rate limit 1000/min) shipped in v2.17.0 (2026-08-19). Skip, but the underlying "docs describe unreleased behavior" pattern is worth one sentence in any public write-up, not an issue.
- **The Documenso community docs stack partly landed.** #3133, #3134, #3135 merged 2026-08-19; #3136, #3137, #3138, #3139 still open. #3136 was rebased onto main, so it can land alone and now fixes the D2a coordinate half; the review's "stacked on a non-main base, cannot land" caveat is stale. D2a/D11/D12 route to comments on #3136; D14 to a comment on #3137; D2b stays its own issue because #3136 does not fix the fieldMeta wipe.
- **Strapi S11 upgraded from a doc bug to a doc bug + a confirmed security escalation.** The live run showed a token holding only `admin::admin-tokens.read` reading a sibling token's full plaintext key and then exercising that token's content-manager tools. Split into a docs issue and a GHSA report.
- **Cal.diy C12 is fixed on main (PR #29740) but in no tag** (newest release v6.2.0 predates it). Skip with a note; pair with C11, which is still broken.
- **calcom/cal.com is the same repository as calcom/cal.diy** (renamed; GitHub redirects). One tracker, one issue-number space. calcom/docs is self-declared obsolete; API-reference doc bugs (C14/C15) file on cal.diy, help-centre (C16) on calcom/help.
- Everything else still reproduces on the default branch today. Strapi's minimum set (S1-S11, S15, S16) was re-run live on 5.52.1 and every one still reproduces.

## Re-verification status per repo (step 3, the live re-run)

- **Strapi: done.** Built develop @ c7dbadd4fe (reports 5.52.1), replayed S1-S11, S15, S16; all still reproduce. Drafts carry `reverified: yes`.
- **Documenso: in progress / see `live/documenso/`.** Drafts carry `RE-VERIFY: pending` until the run's verdicts are folded in.
- **Cal.diy: attempted, blocked on disk.** The clone built and `yarn install` completed, but the machine hit 567 MB free during install, so api-v2 was never built or served and no Cal.diy finding was settled live. The build clone (`scratchpad/build/caldiy`) and an empty `tc_reverify_caldiy` database are preserved for resume; see `live/caldiy/STATUS.md`. Every Cal.diy draft's body says the live re-run is pending for this reason and stands on the original guard evidence plus the 2026-08-19 source re-check. The three medium-confidence findings (C1, C9, C10) are marked `[MEDIUM CONFIDENCE: needs the live re-run to confirm before filing]` in their front matter and must not be filed until confirmed. C4's anonymous GET/DELETE half and C3's seat-count re-read are also still source-derived only. **To resume:** free ~10 GB, then `prisma generate` + `db-deploy`, build api-v2, seed (adapt `/Users/musheghgevorgyan/repos/cal.diy/.truecourse_backup/scenarios/guard-seed.mjs`), and replay the API findings (C2, C3, C4, C5, C6, C7, C8, C9, C14, C15) and the web findings (C1, C10, C11, C12, C13).

## Suggested filing order (after approval)

1. **Docs repo issues** (lowest risk, no security exposure): S12-S16 and S11-doc on strapi/documentation via its `BUG_REPORT.yml`; C16 on calcom/help.
2. **Public product issues**, grouped so related ones cross-reference: Strapi S2+S3 together, S4, then S1, S5, S7, S8, S9, S10; Documenso D3, D4, D5, D2b, D7, D8, D9, D10, D15, D16; Cal.diy C1, C2, C3, C5, C6, C7, C8, C10, C11, C13, C14+C15.
3. **PR comments**: D2a/D11/D12 on #3136, D14 on #3137.
4. **Security disclosures, last and only after a human reads them**: S6 and S11-escalation via GHSA (AI-usage disclosure is mandatory on Strapi's form); D1 via Documenso's advisory form; C4 and C9 via calcom/cal.diy's advisory form plus a cc to security@cal.com.

Per plan step 6, filing uses `gh auth switch -u truecourse-agent` first and `gh auth switch -u mushgev` + `gh config set -h github.com git_protocol ssh` after, and records each issue URL back into `FILING-TABLE.md` and the finding's result JSON (`upstream.filed`).

## Caveats to carry into the drafts (from the plan)

- Cal.diy: the docs at cal.com describe the commercial product; the 30 edition-mismatch failures are not filed. No draft claims anything about the hosted product (the commercial source is private). C1, C2, C5, C7 are in code that predates the fork; C8 is fork-specific.
- Documenso D2b says PR #3136 fixes only the coordinate half; the fieldMeta wipe survives it.
- Strapi S17 (page-size ceiling) was an environment artifact (`examples/getstarted` pins `maxLimit: 30`); not filed.
- Three verbatim doc blockquotes (Cal.diy C5, C6) retain the source's em dashes because normalizing a quotation would misquote the page. Everything the drafts author themselves is em-dash-free.
