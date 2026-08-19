# Re-verify state (started 2026-08-19)

## Source clones (partial, --filter=blob:none), refreshed 2026-08-19

Root: /private/tmp/claude-501/-Users-musheghgevorgyan-repos-truecourse/2bf12aed-ec88-4169-9508-ad041bec80c0/scratchpad

| clone | remote | ref | head (2026-08-19) | tested |
|---|---|---|---|---|
| src/strapi | strapi/strapi | origin/develop | c7dbadd4feec41f0d3892c1bc9f5435e7aad3672 (2026-08-19 17:01 +0200), 14 commits after tested | src/strapi-tested @ c43e9ee1e20f613b63f8f10d9e52be062a8b4a72 (5.52.0, 2026-08-13) |
| src/documenso | documenso/documenso | origin/main | 75330166cc00b29c14399bc2e391e4b4d8080c00 (2026-08-19 20:34 +1000) = tag v2.17.0, 32 commits after tested | src/documenso-tested @ 3cf2963cd03d8b24770b7490bdb20e596baa5d65 (v2.16.0, 2026-07-21) |
| src/caldiy | calcom/cal.diy | origin/main | 176037d0afbe572f870a3c702985e7cd83fe6c0c (2026-08-08 17:13 UTC), unchanged since the 2026-08-15 fetch, 4 commits after tested | src/caldiy-tested @ 038381aeca6261635357957d66b8ba85cdb29737 (2026-07-31) |
| src/calcom | calcom/cal.com | origin/main | 176037d0af, identical to cal.diy main (mirror) | |
| src2/strapi-documentation | strapi/documentation | origin/main | 9226f90506a4a361038f220f24768016a73b5663 (2026-08-19 02:02 UTC) | (reviewed 2026-08-15 at c768c7bf) |

## Tags / releases since 2026-08-15

- strapi: **v5.52.1** (2026-08-19 11:37 UTC, commit a292a53cfd "release: 5.52.1", on develop). Previous: v5.52.0 (2026-08-12).
- documenso: **v2.17.0** (2026-08-19 20:34 +1000, commit 75330166cc = main head). Previous: v2.16.0 (2026-07-21). PR #3081 (rate limit 1000/min) is therefore in a release now.
- cal.diy: no new tag; newest is v6.2.0 (2026-03-01). PR #29740 (phone prefill) is on main, in no tag.

## Guard stores (unchanged inputs)

- /Users/musheghgevorgyan/repos/strapi/.truecourse/ (LATEST run 2026-08-14T15-21-47Z_9ac34d71)
- /Users/musheghgevorgyan/repos/documenso/.truecourse/ (LATEST run 2026-08-14T20-05-03Z_30d3cfc5)
- /Users/musheghgevorgyan/repos/cal.diy/.truecourse/ (LATEST run 2026-08-13T10-49-00Z_ad590c8c)

## Environment constraints

- Disk: ~10 GB free (98% used). Product builds for step 3 run one at a time and are removed afterwards.
- Docker daemon not running. Local Postgres 17 on 127.0.0.1:5432 and Redis on 6379 are up (homebrew services).
- The seed scripts (`reference/seed/guard-seed.mjs`) used by the original runs are not on this machine for any of the three repos, so step 3 is manual reproduction against a locally built instance, not a guard re-run.

## Local services for step 3

- Postgres 17: `postgresql://postgres:postgres@127.0.0.1:5432/postgres` (superuser, password `postgres`). Create per-product databases `tc_reverify_documenso`, `tc_reverify_caldiy`.
- Redis: `redis://127.0.0.1:6379` (homebrew service, running).
- Playwright: `playwright-core` 1.62.1 resolvable from `/Users/musheghgevorgyan/repos/truecourse/packages/guard-runner`; chromium-1234 installed under `~/Library/Caches/ms-playwright`.
- Ports reserved: Strapi 1347, Documenso 3347, Cal.diy API 5347, Cal.diy web 3348.

## Progress log

- 2026-08-19: clones refreshed, STATE/FINDINGS-INDEX/briefs written; 6 research agents (steps 1+2) and the Strapi live agent (step 3) launched.
- 2026-08-19 (cont): all 6 research agents done, all 51 reverify JSONs + 3 POLICY.md written. Strapi live run done (S1-S11,S15,S16 all still reproduce; S11 escalation confirmed live, re-routed to a security disclosure). Documenso live agent building. 7 drafting agents launched (Strapi S1-S6, S7-S10, S11-S16 docs; Documenso D1-D5, D7-D16; Cal.diy C1-C8, C4-C16). Cal.diy live run deferred until Documenso build frees the machine (one heavy build at a time; Cal.diy needs a hand-built seed since guard-seed.mjs is not on disk).

## Key route changes from re-verify (vs the report's fixedAfter)

- D6 (rate limit) FIXED and now RELEASED in documenso v2.17.0 (PR #3081). Skip.
- D13 (get-many body) FIXED in v2.17.0 (PR #3135 merged 2026-08-19). Skip. (Report had fixedAfter: no.)
- D14 half-fixed (documents.mdx fixed by #3135; first-api-call/templates/teams still wrong) -> comment on open PR #3137.
- D2a, D11, D12 -> comment on PR #3136 (now rebased onto main, can land alone). D2b still needs its own issue (the fieldMeta wipe survives #3136).
- #3133 merged (removed the fictional error block from rate-limits.mdx only; first-api-call.mdx still has it -> D10 public issue).
- S11 -> SPLIT: security disclosure (GHSA) for the key-readback escalation (confirmed live) + docs repo issue for the "shown only once" claim.
- S6 -> GHSA (Strapi accepts security only via GHSA; AI-usage disclosure mandatory).
- C4, C9 -> private advisory on calcom/cal.diy + cc security@cal.com (frame as authorization/contract, not DoS).
- C12 FIXED on cal.diy main (PR #29740) but in NO tag -> skip with a note.
- calcom/cal.com == calcom/cal.diy (repo renamed); one tracker. calcom/docs obsolete; API-ref doc bugs (C14/C15) file on cal.diy; help-centre (C16) on calcom/help.

## 2026-08-19 (final): live re-run outcomes

- Strapi live: DONE. develop c7dbadd4fe (5.52.1). S1-S11, S15, S16 all still reproduce; S11 escalation confirmed live -> security disclosure. Build cleaned up.
- Documenso live: DONE. main = v2.17.0 (75330166cc). D1-D5, D7-D11, D14, D15 still reproduce; D6 and D13 confirmed FIXED live. D8's unobserved half (missing accessible name + "12 months" vs "1 year") confirmed. D16 not re-run live (source+doc re-checked). Build cleaned up. Drafts updated with verdicts.
- Cal.diy live: BLOCKED ON DISK. Clone built and `yarn install` completed (node_modules 3.3 GB) but the machine hit 567 MB free during install; api-v2 was never built or served, so NO Cal.diy finding was settled live. Clone preserved at scratchpad/build/caldiy (4.1 GB) + empty db tc_reverify_caldiy for resume. See filing/live/caldiy/STATUS.md. C1, C9, C10 (medium confidence) remain gated on this run and are marked so in their drafts. To resume: free ~10 GB, then prisma generate + db-deploy, build api-v2, seed (adapt .truecourse_backup/scenarios/guard-seed.mjs), replay the api findings (C2,C3,C4,C5,C6,C7,C8,C9,C14,C15) and the web findings (C1,C10,C11,C12,C13).

## Filed (issue URLs)

- Strapi "Admin token permissions on localized content types are deleted at every server restart" (S1) -> **https://github.com/strapi/strapi/issues/27418** (OPEN, filed 2026-08-19 as truecourse-agent, passed the template checker clean, no flag). Supersedes https://github.com/strapi/strapi/issues/27417, which was auto-closed on template format before triage and now carries a comment pointing at 27418; asked maintainers to close it as a duplicate. dosubot confirmed the mechanism on the original. See FILING-GUIDE.md for the format rules this taught us.

## Filing lesson (IMPORTANT for the rest of the batch)

The first filed issue (strapi/strapi #27417) was auto-closed within seconds by the repo's "Check Required Checkboxes" workflow (`.github/workflows/template-check-on-new-issue.yaml`, runs on issues opened+edited). That workflow parses the issue body for `### <Field Label>` section headers matching BUG_REPORT.yml exactly, plus two checked checkboxes (a "checked ... duplicate" box and a "Code of Conduct" box). Our draft used a Markdown table + custom headings, so every required field read as missing -> `flag: invalid template` label + auto-close as not planned.

Fix applied to #27417: reformatted the body to `### Node Version` / `### Package Manager` / ... / `### Bug Description` / `### Steps to Reproduce` / `### Expected Behavior` (subsections demoted to `####` so they do not create spurious `### ` sections) + a `### Confirmation Checklist` with both boxes `[x]`. On edit, the checker re-validated, removed the flag, and posted "it now follows the bug report template." dosubot (Strapi's AI triage) independently CONFIRMED the bug in current develop and suggested labels (issue: bug, source: admin, version: 5, severity: 2). So the content passed; only format failed.

Precise close chain (from the timeline, confirmed): two bots, not one.
- 19:52:39 `github-actions[bot]` added `flag: invalid template` (the template checker).
- 19:53:14 `linear-code[bot]` (Strapi's Linear integration) CLOSED it as not_planned, reacting to that label, 35s later.
- 19:58:37 after my reformat edit, `github-actions[bot]` REMOVED the flag, but `linear-code[bot]` does NOT reopen on unlabel, so it stays closed.
Takeaway: the closer is linear-code[bot] triggered by the `flag: invalid template` label; get the format right on FIRST submit so neither bot fires. Since linear-code will not auto-reopen, prefer filing a fresh correctly-formatted issue over fixing a bot-closed one.

Reopen limitation: truecourse-agent is author but NONE association, and GitHub does not let a non-collaborator author reopen an issue that a bot/maintainer closed. #27417 stays CLOSED until a maintainer reopens; posted a comment (5347308292) asking for reopen.

TODO before filing the rest:
1. Reformat ALL strapi/strapi product drafts (S1-S10) to the `### section-header` + checkbox format. The env values are identical across them (Node 24.14.1, yarn 4.12.0, Strapi 5.52.1, MacOS, SQLite, Javascript) except S10 which is a UI finding (still fill the same env; note the admin panel).
2. Check strapi/documentation's BUG_REPORT.yml (fields: Link to the documentation page, Describe the bug, Additional context, Suggested improvements, Related issues; auto-title `[Bug]: `, auto-label `type: bug`) and whether it has the same enforcement bot, then format the docs drafts (S11-doc, S12-S16, and C16 on calcom/help which has NO template) to match.
3. Check documenso/documenso's `bug-report.yml` sections (Issue Description / Steps to Reproduce / Expected Behavior / Current Behavior / Operating System / Browser / Version + checkboxes) and whether it auto-enforces; reformat D drafts. Our D drafts already use those heading names but as prose headings, verify they are `### ` headers the parser accepts and add the required checkboxes.
4. Check calcom/cal.diy's `bug_report.md` (a Markdown template: Issue Summary / Steps to Reproduce / Actual Results / Expected Results / Technical details / Evidence). Markdown templates are usually NOT auto-enforced the same way, but match the section names anyway.
5. To avoid repeat auto-closes, consider filing a fresh correctly-formatted issue when a draft is materially reformatted, rather than editing a bot-closed one (edits fix the flag but cannot reopen).

## Filed so far

- strapi/strapi #27417 (S1, admin-token permissions deleted at restart): filed 2026-08-19 as truecourse-agent; auto-closed on format, reformatted+flag-cleared, dosubot-confirmed; awaiting maintainer reopen. URL https://github.com/strapi/strapi/issues/27417

## Label convention (user rule: review the last 10-20 issues of the repo before filing)

A NONE-association account cannot apply labels, so each draft should carry a "Suggested labels" line and let maintainers/dosubot apply them.

strapi/strapi taxonomy observed on issues #27350-#27417 (25 sampled):
- `issue: bug` (15/25) or `issue: enhancement`
- `severity: low | medium | high | critical`  <- NAMED, not numeric. dosubot suggested "severity: 2" on #27417, which does not exist in this repo.
- `source: core:admin | core:content-manager | core:upload | core:strapi | core:data-transfer | cli`
- `status: confirmed | pending reproduction`
- `version: 5` (16/25, effectively mandatory)
- `flag: EE`, `Priority: Urgent` (maintainer-applied)
- `flag: invalid template` = the auto-flag we must never trigger (8/25 of recent issues have it, so this trap is common)

Mapping for our Strapi findings: admin-token ones (S1, S11) -> `source: core:admin`; MCP ones (S2-S7) -> `source: core:strapi` or `source: core:content-manager`; Content Manager UI (S10) -> `source: core:content-manager`; REST/routing (S8, S9) -> `source: core:strapi`. All get `issue: bug` + `version: 5` + a severity.

Neighbouring MCP issues worth cross-linking in our MCP drafts: #27395 (MCP tools/list advertises draft-07 JSON Schema), #27353 (MCP tool names collide for content types sharing an API), #27397 (CM list view draft/publish status).

## Transcript attachment policy

Drafts end with "the full transcript is available on request" rather than pasting it. Reasons, measured: one scenario transcript is ~27 KB against GitHub's 65 KB issue-body limit, so a single one nearly fills an issue and buries the report; the evidence dir per scenario is ~96 KB including screenshots; and the transcripts contain live credentials (admin jwt, token accessKey) that would need redaction before publication. The drafts already inline the specific requests and responses that prove the claim. If a maintainer asks, attach the redacted transcript as a gist or a file attachment on the issue rather than inline.
