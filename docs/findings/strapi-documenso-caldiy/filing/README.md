# Filing package: Strapi, Documenso, Cal.diy findings

Re-verified 2026-08-19, before anything is filed upstream. This folder is the output of `REVERIFY-PLAN.md`. **Nothing here has been filed. Nothing is filed without human approval.**

## What is here

- `FILING-TABLE.md` - one row per finding (49 distinct findings, ids S1-S17 / D1-D17 / C1-C16 from `../strapi-documenso-caldiy.md`): still present on the default branch today, live re-run verdict, new upstream reports since 2026-08-15, route, confidence, draft file. Per-finding filer notes follow the table. **Generated**; edit the sources, not the file.
- `issues/<target>/<ID>-<slug>.md` - one drafted issue (or PR comment, or security report) per filable finding, ready to paste or `gh issue create --body-file`. Each has a front-matter block (`finding`, `target`, `route`, `title`, `labels`, `status: draft`, `reverified`) that is not part of the pasted body.
- `reverify/<repo>/<ID>.json` - the step 1+2 re-check per finding (source state today, doc state today, tracker dedupe, cited-item state, route + policy basis). `reverify/<repo>/POLICY.md` - each repo's security policy, CONTRIBUTING and issue-template requirements, quoted.
- `live/<repo>/` - the step 3 live re-run: a fresh instance built from today's default branch, the scenario replayed by hand, evidence captured. `live/<repo>/REPORT.md` + `summary.json` summarize; per-finding `<ID>/repro.md` hold the requests, responses and screenshots.
- `FINDINGS-INDEX.json` - the machine index tying finding ids to scenarios, review JSONs, culprit files and the live-required set.
- `STATE.md` - clone heads, tags, local services, and the running log with the route changes the re-verify surfaced.
- `tools/build-table.py` - regenerates `FILING-TABLE.md` from the JSONs, the live summaries and the drafts' front matter. Run from this folder's parent (`docs/findings/strapi-documenso-caldiy/`): `python3 filing/tools/build-table.py`.

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
