# Re-verify the findings before filing upstream

Goal: before any issue is opened on strapi/strapi, documenso/documenso or calcom/cal.diy, confirm each finding is still present today, is not already reported or fixed, and is routed correctly (public issue vs security disclosure vs docs repo). Output: a filing table plus one drafted issue per finding, ready for human approval. Nothing is filed until approved.

## Inputs (all local, all untracked)

- `docs/findings/strapi-documenso-caldiy.md` — the report. The S1-S17, D1-D17, C1-C16 ids used below come from its tables.
- `docs/findings/strapi-documenso-caldiy/<repo>/<scenario-id>.json` — one file per reviewed failure (117). Each has: `docClaim` (quote + doc path), `observed`, `rootCause` (file, lines, explanation), `introducedBy` (commit, PR, date), `upstream` (issues, PRs, queries used), `fixedAfter`, `colleagueFinding`, `notes`. Multi-defect scenarios carry `additionalDefects[]`.
- `docs/findings/strapi-documenso-caldiy/REVIEW-BRIEF.md` — how the review was done (verdict vocabulary, what "fixed after" meant, the Cal.diy edition caveat).
- The guard stores with scenarios and evidence:
  - `/Users/musheghgevorgyan/repos/strapi/.truecourse/` (run `2026-08-14T15-21-47Z_9ac34d71`, tested `develop` @ `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72`, Strapi 5.52.0)
  - `/Users/musheghgevorgyan/repos/documenso/.truecourse/` (run `2026-08-14T20-05-03Z_30d3cfc5`, tested tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65`)
  - `/Users/musheghgevorgyan/repos/cal.diy/.truecourse/` (run `2026-08-13T10-49-00Z_ad590c8c`, tested `main` @ `038381aeca6261635357957d66b8ba85cdb29737`)
  - per scenario: `scenarios/<area>/<id>.yaml` (the steps), `guard/evidence/<runId>/<id>/` (transcript.txt, response, screenshots, server logs). Note: some evidence lives in an earlier run dir than LATEST; `guard/LATEST.json` → `scenarios[].evidencePath` is authoritative.
- Source clones used by the review (may need re-fetching; partial clones, `--filter=blob:none`): were under the session scratchpad `src/{strapi,strapi-tested,documenso,documenso-tested,caldiy,caldiy-tested,calcom}`. If gone, re-clone: `strapi/strapi` (`develop`), `documenso/documenso` (`main`), `calcom/cal.diy` (`main`); worktrees at the tested commits above. `calcom/cal.com` is a mirror of cal.diy (same commit), not a separate source.

## What to produce

`docs/findings/strapi-documenso-caldiy/filing/` (untracked):
- `FILING-TABLE.md`: one row per finding: id, repo, title, still present on default branch today (yes/no/changed, with the commit that changed it), new upstream report since 2026-08-15 (issue/PR or none), route (public issue / security disclosure / docs repo issue / skip: fixed / skip: reported), confidence, notes.
- `issues/<repo>/<id>-<slug>.md`: the drafted issue text, one file each, ready to paste or to `gh issue create --body-file`.

## Steps

### 1. Refresh upstream state (all repos)

- Fetch the default branches as of today and record the head sha and date.
- For each finding, `git log <tested-commit>..<default> -- <culprit files>` using `rootCause.file` from the result JSON (and the sibling files named in `rootCause.explanation` / `notes`). Read any diff that touches the culprit lines and decide: unchanged / changed but bug remains / fixed (name commit + PR).
- List tags/releases created since 2026-08-15 in each repo (`gh release list`, `git tag --sort=-creatordate`). For anything marked fixed on the default branch, say whether it is now in a release. This matters for Documenso D6 (rate limit, fixed on main, was in no tag) and Cal.diy C12 (phone prefill, PR #29740, was in no tag).

### 2. Re-search the trackers (dedupe)

- For each finding, re-run the tracker search with the queries recorded in `upstream.queries` of its JSON, plus one search by the exact symptom phrase, restricted to items created/updated after 2026-08-15. Record new exact or related issues/PRs.
- Re-check the state of every upstream item the review cited: Documenso community stack #3133, #3134, #3135, #3136, #3137, #3138, #3139 (were open and blocked), #3081 (merged), issue #3191; Cal.diy #28762, #29785, #28512, #28561, #8985, #25641, #29739/#29740, #25011, #23136; Strapi #26990 (open, touches the filters builder), #27027. If any merged, re-evaluate the findings that depend on them.

### 3. Live re-verification (the part that turns "still in source" into "still happens")

Preferred path: re-run the specific scenarios with the guard against a fresh instance built from today's default branch (and, for Documenso, from the newest tag), then compare with the original transcript. Recipes are in each store's `scenarios/recipe.json`; the Cal.diy run's seed script (`reference/seed/guard-seed.mjs`, ~60 fixtures) is NOT in the cal.diy checkout (only an older, smaller seed is in `.truecourse_backup/`), so Cal.diy re-runs need that seed recovered from whoever ran it, or a manual reproduction. Scenario ids per finding are in the report tables and the JSON filenames.

If a full re-run is not possible for a repo, reproduce manually with the minimal steps from the scenario yaml and transcript (curl/HTTP for api scenarios, a browser for web ones) against a locally built instance, and record request + response as evidence.

Minimum set to re-run live, because these are the ones we will lead with or that had a caveat:
- Strapi S1 admin-token permissions reaped on restart (`a-permission-configured-through-the-admin-api-does-not-outlive-a-restart.api.1`), S6 raw SQL in MCP error (`the-filter-operators-the-docs-enumerate.api.1`, needs a write to fail: easiest is a unique-constraint violation or a locked sqlite db; the original hit "database is locked" under concurrency), S2/S3/S4 relation writes (`relations-are-written-through-connect-disconnect-and-set.api.1` and the sibling run `2026-08-14T15-15-28Z_32215874` for `set: null`), S5/S7 (`the-filter-operators...`, `the-list-tool-paginates-its-results.api.1`), S8 (`the-status-parameter-drives-a-create-an-update-and-a-delete.api.1`), S9 (`delete-a-document.api.1`), S10 (`bulk-unpublishing-the-selected-entries.web.1`).
- Documenso D1 frozen document (`a-draft-accepts-changes-and-a-sent-document-refuses-them.api.1`, also exercise steps 8-12 which never ran), D2 update-many (`move-and-delete-a-field-on-a-draft.api.1`), D3 (`an-assistant-is-refused-on-a-parallel-envelope.api.1`), D4 (`reject-a-document-on-a-recipients-behalf.api.1`), D5 (`the-documented-field-configuration-constraints.api.1`), D6 on the newest tag (`every-api-response-carries-the-rate-limit-headers.api.1`), D7/D9 (`a-none-distribution-send-offers-the-signing-links.web.1`), D8 (`the-token-expiry-choices-the-docs-list.web.1`).
- Cal.diy C1 OOO (`an-out-of-office-period-closes-the-booking-page.web.1`; this is the medium-confidence one: confirm the seeded OOO entry and the date-override-only schedule exist, or recreate them, then load the page), C2 zero-length slots (`list-the-slots-two-people-share.api.1`), C3 seated attendee (`seated-bookings-refuse-attendees-and-guests.api.1`, and re-read the booking afterwards to settle the seat-count claim), C4 hold PATCH (`only-an-authenticated-caller-may-change-the-hold-length.api.1`, also try GET/DELETE anonymously), C5 auto-confirm (`reschedule-a-pending-booking.api.1`), C6 (`reschedule-refuses-a-non-reschedulable-booking.api.1`), C7 cache (`reserve-a-slot-and-read-the-reservation-back.api.1`), C8 reassign stubs (`reassignment-refuses-a-non-round-robin-booking.api.1`), C9 rate limit (`the-api-rate-limits-at-120-requests-a-minute.api.1`; medium confidence: capture `X-RateLimit-*` headers on a burst to isolate guard-not-applied vs storage-never-blocking), C10 dynamic group opt-out (`a-user-who-left-dynamic-group-links-cannot-be-added-to-one.web.1`), C11/C12 phone field (`a-phone-only-event-type-books-without-an-email-address.web.1`, `prefill-the-attendee-phone-number-either-way-it-is-asked.web.1`; C12 should now PASS on main if #29740 is in, C11 should still fail), C13 (`prefill-the-location-a-booker-arrives-with.web.1`).

Record for each: date, build (sha/tag), result (still reproduces / fixed / could not reproduce, with why), evidence path.

### 4. Route each finding

Read each repo's `SECURITY.md` / security policy and `CONTRIBUTING.md` first. Then:
- **Security disclosure, not a public issue**: anything that leaks data or bypasses auth. Candidates: Strapi S6 (raw SQL with bound values to any MCP client), Strapi S11's escalation (a token holding only `admin-tokens.read` can read back its owner's other tokens' plaintext keys; verified in source, not exercised: exercise it first), Cal.diy C4 (anonymous move/extend/cancel of another booker's hold, and unbounded duration), Cal.diy C9 (rate limit not enforced), Documenso D1 (third party gains a live signing link on a sent document). Decide per repo policy; if the policy says "report privately", draft it as a private report, not an issue.
- **Docs repo**: Strapi doc bugs S11-S17 go to `strapi/documentation`, not `strapi/strapi` (the review recorded the doc file and line). Documenso doc bugs live in `apps/docs/` of the main repo, and several are already covered by the open community PRs (#3133-#3139): for those, comment on or upvote the existing PR rather than filing duplicates. Cal.diy doc bugs C14/C15 are in the product tree (`slots.controller.ts` descriptions) so they are code issues; C16 is in `calcom/help`.
- **Skip**: fixed upstream since (Documenso D6, Cal.diy C12) unless the point is "not yet released", in which case a short note on the existing PR is enough. Anything now reported by someone else: link to it instead.
- **Public issue**: everything else.

### 5. Draft the issues

One file per finding under `filing/issues/<repo>/`. Shape: title; one-paragraph summary; "Docs" (the sentence, page URL); "Reproduce" (numbered steps with exact requests/bodies from the scenario, the build tested); "Observed" vs "Expected" (from the transcript); "Cause" (file:line permalink at the tested commit, one paragraph, the introducing PR); one closing line that it was found by TrueCourse reading the docs against a live instance and that the full transcript is available. No em dashes. Plain, no selling. Use the tone approved in the session (see the three samples the coordinator showed for S1, D1, C1).

For multi-defect scenarios, file one issue per defect (S2, S3, S4 are three issues; D2 is two: coordinate no-op and fieldMeta wipe).

### 6. Filing (only after human approval of the table and drafts)

- `gh auth switch -u truecourse-agent` before filing; `gh auth switch -u mushgev` and `gh config set -h github.com git_protocol ssh` after.
- File in the order the human approves; record the issue URL back into the filing table and into each result JSON (`upstream.filed`).

## Known caveats to carry into the drafts

- Cal.diy: docs at cal.com describe the commercial product; the 30 edition mismatches are not to be filed as bugs. C8 (reassign stubs) is Cal.diy-specific (fork commit); C1, C2, C5, C7 are in code that predates the fork.
- Documenso D2's community PR #3136 fixes only the coordinate mapping, not the fieldMeta wipe; say so in the issue rather than filing a duplicate of the half that is covered.
- Strapi S17 (page size ceiling) was an environment artifact (`examples/getstarted` pins `maxLimit: 30`), not a finding; do not file.
- Three Cal.diy findings were medium confidence in the review (C1, C9, C10); step 3 is what upgrades or drops them.
