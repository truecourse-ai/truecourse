# Failure review brief

You are reviewing ONE failing guard scenario from a TrueCourse run against an open-source product. TrueCourse reads a product's published docs, generates executable test scenarios from the doc claims, and runs them against a live instance of the product. A failure means the product did not do what the scenario asserted. Your job: decide whether the failure is a real product defect, a documentation bug, or a defect of the generated test/environment, and find out whether upstream already knows about it or fixed it after the tested build.

## Ground rules

- READ ONLY on the source clones. Several reviewers share the same worktrees at once. Never run `git checkout`, `git switch`, `git reset`, `git stash`, `git pull` or edit files inside them. Use `git show <rev>:<path>`, `git log`, `git log -S/-G`, `git blame`, `git diff <a> <b> -- <path>`, and `gh`.
- The clones are partial (`--filter=blob:none`): blobs download on demand, so the first `git blame`/`git show` on a file may take a few seconds. That is fine.
- GitHub search is rate limited (30 searches/min for the whole account, shared with the other reviewers). Use at most 3 `gh search issues` / `gh search prs` calls. If you get a rate-limit error, sleep 90 seconds and retry once. `gh api repos/<owner>/<repo>/pulls/<n>` and `gh pr view` are not search calls and are fine.
- Do NOT hit any live production service with writes, and do not create accounts. The single exception: one unauthenticated GET to read public response headers if that alone settles a "is the fix deployed" question.
- Do not guess. If evidence + source do not settle it, say `unverified` and state exactly what would settle it.
- No em dashes anywhere in your output. Use commas, colons, or plain hyphens.
- Write your result to the output path you are given, as JSON in the schema below, then reply with a 3 to 5 line plain summary. Nothing else is to be modified.

## Where things are

Scratch root: `/private/tmp/claude-501/-Users-musheghgevorgyan-repos-truecourse/2bf12aed-ec88-4169-9508-ad041bec80c0/scratchpad`

Source clones under `<scratch>/src/`:
- `strapi/`         upstream `strapi/strapi`, branch `develop` (their main development branch), fetched 2026-08-15
- `strapi-tested/`  worktree at the TESTED commit `c43e9ee1e20f613b63f8f10d9e52be062a8b4a72` (Strapi 5.52.0, 2026-08-13)
- `documenso/`      upstream `documenso/documenso`, branch `main`, fetched 2026-08-15
- `documenso-tested/` worktree at the TESTED tag `v2.16.0` = `3cf2963cd03d8b24770b7490bdb20e596baa5d65` (2026-07-21 05:06 UTC)

"Fixed after" means: is the buggy behavior changed on the upstream default branch (`develop` for Strapi, `main` for Documenso) at a commit later than the tested one, or in a merged PR. `git log <tested>..<default> -- <file>` on the culprit file is the fastest check; then read the diff. Name the PR/commit and its date. For Documenso also say whether it is in a tag (`git tag --contains <sha>`); v2.16.0 is the newest tag as of 2026-08-15, so anything merged after 2026-07-21 05:06 UTC is on main only.

Guard stores (data you review), under `<repo>/.truecourse/`:
- Strapi:    `/Users/musheghgevorgyan/repos/strapi/.truecourse/`
- Documenso: `/Users/musheghgevorgyan/repos/documenso/.truecourse/`

Per failure you get:
- `yamlPath`: the scenario. Steps in order; each `request`/`expect` pair, with a `note` explaining the assertion and `milestone` ids naming the doc claims it proves. Web scenarios use `navigate`/`click`/`fill`/`expect` steps.
- `evidenceDir`: the run's transcript for that scenario. `transcript.txt` is the human-readable log of every step (request, response, verdict). `invocation.json` is the failing step's request. `response.txt`/`response.raw.txt` the failing response. `server.stdout.txt`/`server.stderr.txt` the product's own logs during the scenario. `diff.txt` expected vs actual. Web scenarios may also have screenshots and an accessibility snapshot.
- `docs`: the spec pages the scenario binds to. These are the product's own published docs, snapshotted as markdown under `.truecourse/specs/sources/<site>/...`. The doc claim is what the scenario asserts. Find the exact sentence.
- `failure`: the failing step number, `expected`, `actual`.

The Strapi instance was the tested checkout run from source (`develop` @ c43e9ee1e2) with a generated content type; the MCP server was driven over HTTP (`/mcp`, SSE responses). The Documenso instance was the tested tag run from source with a seeded team `guard-owner`. Both were driven with API tokens created by the run's setup steps.

## What to decide, per failure

1. **What exactly failed.** Read the failing step, its note, the expected/actual, and the transcript. Restate it in one sentence a maintainer would accept.
2. **What the doc promises.** Quote the sentence(s) from the bound doc page(s). Note if the docs disagree with each other.
3. **Verdict**, one of:
   - `real-defect`: the product does not do what its docs (or its own schema/contract) say, and a user following the docs is harmed. Includes silent no-ops, wrong confirmations, security/info-disclosure, and contract mismatches.
   - `doc-bug`: the product behavior is sane and intentional; the doc text is wrong or stale. Say which repo the doc lives in (Strapi's user docs live in the separate `strapi/documentation` repo, not in the tested checkout; Documenso's docs live in `apps/docs/` inside the same repo).
   - `test-defect`: the generated scenario asserted something the doc does not actually promise, mis-encoded the request, or depends on state it did not set up. The product is fine.
   - `environment`: the failure comes from the sandbox (missing service, seed, network, timing) rather than the product or the test.
   - `unverified`: cannot be settled from evidence + source; state what is missing.
   Give a confidence: high / medium / low.
4. **Root cause in source** (for real-defect and doc-bug): file path and line range in the tested worktree, and a one-paragraph explanation. Verify by reading the code, do not infer from names.
5. **Introduced by**: `git blame` the culprit lines in the tested worktree; name the commit, its date, and the PR number from the commit message (`(#NNNN)`). If the code is old and the bug is an interaction with newer code, say which is which.
6. **Upstream tracker**: search issues and PRs (open and closed) for the symptom. Report exact matches and related items with number, URL, state, title, and how they relate. If nothing, say `none found` and list the queries you used.
7. **Fixed after**: per the definition above. `yes` (name PR/commit/date, whether in a tag), `no`, `partial` (e.g. docs-only fix, or fix on a different code path), or `unknown`.
8. **Colleague cross-check**: the researcher's write-up is below. If this failure maps to one of the numbered findings there, say which, and whether your evidence agrees, disagrees, or refines it (e.g. their blame PR, their "unreported" claim). If it does not map to any of them, say so; the researcher's write-up covers only a subset of the failures.

## Output schema (JSON, write to the given output path)

```json
{
  "repo": "strapi" | "documenso",
  "scenarioId": "...",
  "flowId": "...",
  "failingStep": 0,
  "whatFailed": "one sentence",
  "docClaim": { "quote": "...", "doc": "repo-relative doc path", "section": "..." },
  "observed": "what the product actually did, from the evidence",
  "verdict": "real-defect" | "doc-bug" | "test-defect" | "environment" | "unverified",
  "confidence": "high" | "medium" | "low",
  "impact": "one line: who is harmed and how (silent data loss, wrong contract, info disclosure, none, ...)",
  "rootCause": { "file": "...", "lines": "a-b", "explanation": "..." } | null,
  "introducedBy": { "commit": "sha", "date": "YYYY-MM-DD", "pr": "#NNNN", "title": "...", "note": "..." } | null,
  "upstream": {
    "issues": [ { "number": 0, "url": "...", "state": "open|closed", "title": "...", "relation": "exact|related", "note": "..." } ],
    "prs":    [ { "number": 0, "url": "...", "state": "open|merged|closed", "title": "...", "relation": "exact|related", "note": "..." } ],
    "queries": [ "..." ]
  },
  "fixedAfter": { "status": "yes" | "no" | "partial" | "unknown", "by": "PR/commit or null", "date": "YYYY-MM-DD or null", "inTag": "tag or null", "note": "..." },
  "colleagueFinding": { "ref": "strapi #2" | "documenso #4" | null, "agreement": "agrees|disagrees|refines|n/a", "note": "..." },
  "notes": "anything else a maintainer or the doc author should know"
}
```

## The researcher's write-up (for cross-check only; verify, do not copy)

### Strapi 5.52.0 (MCP server + admin-token auth), 8 findings, all claimed unreported

1. Admin-token permissions silently vanish on restart. Grant a token permissions via the API, the next server restart deletes them; the token still works but can do nothing. Scenario: a-permission-configured-through-the-admin-api-does-not-outlive-a-restart.api.1
2. "Clear all relationships" (set: null) returns success and does nothing. Scenario: relations-are-written-through-connect-disconnect-and-set.api.1
3. Two mutually exclusive relationship ops in one call (docs say forbidden) are accepted and one is silently dropped. Same scenario as 2.
4. Two documented filter operators reject the input the rest of Strapi requires and mis-handle the workaround. Scenario: the-filter-operators-the-docs-enumerate.api.1
5. After an update of an item's relationships the confirmation shows the field empty though the change saved. Same scenario as 2.
6. Default page size contradicts the tool's own schema: schema says 25, product returns 10 (REST returns 25). Scenario: the-list-tool-paginates-its-results.api.1
7. Raw SQL leaks to the client on a write error. Scenario: the-filter-operators-the-docs-enumerate.api.1
8. Docs materially wrong: an admin token's secret key is documented as "shown only once" but is returned on every read; documented tool names and permission requirements do not match the product. Scenarios: an-admin-token-authenticates-the-admin-api-and-its-key-is-read-back.api.1, the-two-draft-and-publish-tools-the-docs-scope-to-the-publish-permission.api.1

Their git blame (HEAD c43e9ee1e2):
- PR #26371 "introduce MCP server" (commits d6f693da85 + 9247b9b093, 2026-05-27): findings 2, 3 (data-schema.ts), 4 (filters-schema.ts, every operator inherits the field's value type), 6 (input-schemas.ts), 7 (tool-registry.ts echoes the raw error verbatim).
- PR #25657 "api token supports admin permissions and admin user ownership" (commit 52b8fd9e3d, 2026-04-29): finding 1 (added token permissions, never taught the boot-time cleanup about them, so they get reaped; the cleanup itself traces to PR #18232, 2023) and 8a (controllers/admin-token.ts hands the key back).
- PR #26560 "reduce MCP relation output to identity-only shape" (commit 00da31ed44, 2026-06-19): finding 5 (the handler is from #26371).
- 8b (the discard-tool permission mismatch) is a DOCS bug; the code mapping is correct and old (PR #19380, 2024); the wrong text lives in strapi/documentation.

### Documenso 2.16.0 (v2 signing API + web signing UI), 18 failures, 8 itemized

Headline: 6 previously unreported defects, 5 independently confirmed by community PRs unmerged for two weeks, 2 fixed upstream within days of the tested build.

1. POST /envelope/field/update-many returns 200 and moves nothing (route reads one set of coordinate names, service writes another). Community PR #3136 fixes it, unmerged, still broken on main. Scenario: move-and-delete-a-field-on-a-draft.api.1
2. Updating one property of a radio/checkbox/dropdown field resets its options to defaults behind a 200. Unreported. Same scenario as 1.
3. Docs say recipients and fields cannot change once sent; the API adds a recipient to a PENDING document. Unreported. Scenario: a-draft-accepts-changes-and-a-sent-document-refuses-them.api.1
4. Field coordinates go out as numbers, come back as JSON strings; docs, schema and wire disagree. PR #3136 has a docs-only patch. Scenario: place-fields-on-a-draft-by-coordinates.api.1
5. Every API error is labeled INTERNAL_SERVER_ERROR at the top level, the real code one level down. Unreported. Scenario: the-documented-error-envelope-on-an-unknown-envelope.api.1
6. Docs say a rejection moves the document to Rejected "immediately"; it is written by an async job, the next read still says Pending. Unreported for the normal case; a related edge (a stuck job) is filed. Scenario: reject-a-document-on-a-recipients-behalf.api.1
7. The send screen promises signing links after a manual send and shows none (copy-to-clipboard behind an unlabeled control). Unreported. Scenario: a-none-distribution-send-offers-the-signing-links.web.1
8. Two controls have no accessible name (API-token expiry selector, "Copy Signing Links"); the pattern is app-wide. Unreported. Scenarios: the-token-expiry-choices-the-docs-list.web.1, a-none-distribution-send-offers-the-signing-links.web.1

Already established by the coordinator (do not re-research, just reuse if relevant): Documenso `every-api-response-carries-the-rate-limit-headers.api.1` fails because docs say 1000 req/min per IP and v2.16.0 answers `x-ratelimit-limit: 100`; PR #3081 "fix: increase global API rate limits to 1000/min" merged to main 2026-07-21 05:58 UTC (52 minutes after the v2.16.0 tag), not in any tag; app.documenso.com answers 1000 as of 2026-08-15; docs PR #3133 (rate-limit headers and 429 variants) open since 2026-07-30.

## Cal.diy (third target), read this section if your brief says `"repo": "caldiy"`

Cal.diy (`calcom/cal.diy`) is the community, MIT-licensed fork of Cal.com created in spring 2026 when Cal.com split its commercial product from its open-source one. Its README states: "a fork of Cal.com with all enterprise/commercial code removed", "No enterprise features: Teams, Organizations, Insights, Workflows, SSO/SAML, and other EE-only features have been removed", "no hosted/managed version". The docs the scenarios were generated from are Cal.com's public docs (`cal.com/docs`, including the API v2 reference, and `cal.com/help`), which describe the COMMERCIAL / hosted Cal.com. So a Cal.diy failure can have a cause the other two targets cannot: the doc claim is true of Cal.com and simply not part of Cal.diy.

Extra verdict value for this repo only:
- `edition-mismatch`: the doc describes a Cal.com feature, field, endpoint, plan gate, or behavior that Cal.diy does not ship (removed EE/commercial code, hosted-only service, or a change that landed in `calcom/cal.com` and was never ported). Evidence required: point at the code in `calcom/cal.com` main that implements the documented behavior AND show it is absent or different in the Cal.diy tested worktree (or the feature directory is gone). If Cal.diy has the code and it misbehaves, that is a `real-defect`, not an edition mismatch, even if Cal.com fixed it later (then it is "fixed after" in Cal.com but not ported).

Locations:
- Store: `/Users/musheghgevorgyan/repos/cal.diy/.truecourse/` (docs under `specs/sources/cal.com-docs/` and `specs/sources/cal.com-help/`).
- `<scratch>/src/caldiy/`         upstream `calcom/cal.diy` `main` (fetched 2026-08-15, head 176037d0af, 2026-08-08)
- `<scratch>/src/caldiy-tested/`  worktree at the TESTED commit `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31)
- `<scratch>/src/calcom/`         the PUBLIC `calcom/cal.com` `main` (fetched 2026-08-15). VERIFIED 2026-08-15: its `main` is the SAME commit as `calcom/cal.diy` `main` (176037d0af, identical tree). The commercial Cal.com source is NOT public any more (community references call it `calcom/cal`, private). So this clone is a mirror and cannot serve as the commercial cross-reference. Do not report "fixed in cal.com" from source; you can only say what the public docs / changelog / public issues and PRs (calcom/cal.com, calcom/cal.diy, calcom/companion, calcom/docs) show. Evidence for `edition-mismatch` is therefore: the documented behavior, field, endpoint or API version is absent from the Cal.diy tested tree (e.g. `packages/platform/constants/api.ts` lists no such `cal-api-version`; the field name appears nowhere; the feature directory is gone), plus the docs describing it as a Cal.com feature. Cite the public trace if one exists (e.g. issue calcom/cal.diy#28762 names the 2024-08-13 vs 2026-02-25 bookings API drift).
- The tested instance ran API v2 (`apps/api/v2`, NestJS) and the web app (`apps/web`) from source, seeded by `reference/seed/guard-seed.mjs` (a `reference-host` user with several event types, API keys as `{{cred:host-api-key}}` etc.). API scenarios send `cal-api-version` headers as the docs instruct.

"Fixed after" for Cal.diy: check `git log 038381aeca..origin/main -- <file>` in `caldiy` (only a handful of commits landed there since). For the commercial Cal.com you have no source: say "in cal.com: not verifiable from source" unless a public PR/issue/changelog entry settles it. `fixedAfter.note` must still say "in cal.diy: ..., in cal.com: ...". Upstream tracker searches: `calcom/cal.com` is where the community files things; `calcom/cal.diy` has its own issues too. Search both within the 3-search budget (a query without `--repo` scoped to `org:calcom` counts once).

Three Cal.diy failures are `error` outcomes (page.goto timeouts on public booking pages). For those, decide `environment` vs `real-defect` from the server logs in the evidence dir (was the page 500ing, compiling, or the sandbox slow), and say what would settle it.

The researcher's Cal.diy write-up exists: `/Users/musheghgevorgyan/repos/cal.diy/docs/guard-findings.md` (untracked, 2026-08-13, titled "What we found in cal.com", 5 findings, all "reproduced by hand"). Read it and map your failure onto it if it fits; refs are `caldiy #1` to `caldiy #5`. The five, in short: #1 an out-of-office period is ignored when availability comes from date overrides rather than a weekly schedule (days stay bookable, no OOO emoji or note); #2 team/group availability slots come back zero-length (start == end) though docs say each is 30 minutes; #3 a date override 9:10-10:10 yields one 9:30 slot, the 9:10 slot is silently dropped; #4 adding an attendee to a seated booking is accepted instead of refused, seat counts go wrong (negative seats left, oversold); #5 a temporary slot reservation (hold) can be read, moved, extended or cancelled by anyone who knows its id, with no authentication, though docs say changing a hold is for authenticated callers. Verify, do not copy; one reviewer already found #3 to be documented default slot-grid behavior (Optimized Slots off) with an upstream "won't change" issue calcom/cal.diy#25011, so disagreeing with the write-up is allowed when the evidence says so.

### Cal.diy: two systemic causes already established (reuse, do not re-derive)

1. **API version header not shipped by Cal.diy.** The docs (and so the scenarios: 139 step lines with `cal-api-version: 2026-02-25`, 49 with `2026-05-01`) mandate versions that Cal.diy does not have. `packages/platform/constants/api.ts:56-68` in the tested tree tops out at 2024-09-04, and `apps/api/v2/src/bootstrap.ts:31-41` silently downgrades an unknown version to 2024-04-15, so the body is validated against the 2024-04-15 input (flat `timeZone`, `language`, `metadata`; the `attendee` object is whitelist-stripped), typically a 400 naming those fields. Public trace: issue calcom/cal.diy#28762 (exact), #29785, #28512; PR #28561 (proposed mapping 2026-02-25 to 2024-08-13) closed unmerged 2026-03-25, its author confirming prod serves 2026-02-25 while the source tree does not. If your failing step is this, verdict `edition-mismatch`, cite the above, and spend your effort on (a) whether the scenario would ALSO fail on the versions Cal.diy has, and (b) whether the bound doc claim itself has a Cal.diy-side defect independent of the version.
2. **Run-start saturation of the web sandbox.** 17 web scenarios launched at once against a just-started `next start` (production build) with Prisma `connection_limit=3`, 10 s step budget including `page.goto`; first-wave navigations had a median of about 13 s (max 18.6 s), later waves about 4 s. Booking pages that omit `?month=` pay two sequential slot fetches (empty-month auto-advance) and are still skeleton cells at the deadline; screenshots seconds later show the rendered, correct page. If your failure is a first-wave web timeout or a "still loading" assertion with a rendered post-deadline screenshot, verdict `environment`, say which of the two signatures it is, and check whether the doc claim was nevertheless evidenced by the later frames.

Also: every web evidence dir in this run has 0-byte server logs (the web driver does not capture the long-lived Next server's output); do not read that as "no server error".
3. **Cross-scenario slot contention (web).** All seeded event types hang off one host (`reference-host`) with one 09:00-17:00 schedule. Sibling scenarios in the same parallel run booked that host at 2030-06-12T09:00Z (seated-consult, notice-confirm) and other shared slots; Cal.diy correctly treats an ACCEPTED booking as host-wide busy time (`BookingRepository.ts:686-795` has no eventTypeId filter), so a hardcoded slot label such as "9:00am" vanishes for every scenario that loads later (buffered event types lose 9:30am too). If your step clicked a hardcoded time and the page shows a fully rendered grid without it, verdict `test-defect` (the scenario hardcodes a slot it never reserved), and say whether the doc claim itself was ever exercised.
