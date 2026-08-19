# Cal.diy / Cal.com filing policy (checked 2026-08-19)

## 0. The single most important fact: calcom/cal.com IS calcom/cal.diy

`gh api repos/calcom/cal.com` returns `"full_name": "calcom/cal.diy"`, `"name": "cal.diy"`,
`"created_at": "2021-03-22"`, `"html_url": "https://github.com/calcom/cal.diy"`.
The repository that used to be `calcom/cal.com` was **renamed** to `calcom/cal.diy`; GitHub serves the old
path as a redirect. There is therefore exactly ONE public repo and ONE public tracker for both names:

- Every `calcom/cal.com#NNNN` reference in the review JSONs resolves to `calcom/cal.diy#NNNN`. Same issue, same number.
- A search scoped `org:calcom` (or `gh search issues --owner calcom`) covers both names in one call.
- `gh search issues --repo calcom/cal.com ...` is rejected ("the resources do not exist or you do not have
  permission") because search does not follow the rename redirect. Use `--owner calcom` or `--repo calcom/cal.diy`.
- The **commercial Cal.com source is not on GitHub publicly**. Nothing about the hosted product can be
  verified from source, and no finding may claim "fixed in cal.com".

The repo's own PR welcome bot states the split (comment on PR #29383, 2026-05-17):

> "**This is Cal.diy, not Cal.com.** Cal.diy is a community-driven, fully open-source fork of Cal.com licensed
> under MIT. Your changes here will be part of Cal.diy, they will **not** be deployed to the Cal.com production app."

`CONTRIBUTING.md` line 3 says the same:

> "Cal.diy is a community-driven, open-source fork of Cal.com. Contributions made here **do not** get merged into
> Cal.com's production service" ... "Cal.com is now closed-source. This repo is maintained independently by the
> community under the MIT license."

Consequence for filing: **every source-level defect goes to calcom/cal.diy**, and the report must not assert
anything about the hosted product. Where the doc claim comes from cal.com's published API reference (the
`docs.cal.com` / `cal.com/docs` OpenAPI, which Cal.diy publishes no substitute for), say so explicitly.

## 1. calcom/cal.diy security policy

- File: https://github.com/calcom/cal.diy/blob/main/SECURITY.md (root, not `.github/`; `.github/SECURITY.md` is 404).
- **Private vulnerability reporting is ENABLED**: `gh api repos/calcom/cal.diy/private-vulnerability-reporting`
  returns `{"enabled": true}`, so the "Report a vulnerability" button exists at
  https://github.com/calcom/cal.diy/security/advisories/new . SECURITY.md itself does not mention it.
- The operative sentence is email, not the button:

  > "E-mail your findings to [security@cal.com](mailto:security@cal.com)."

  and the header line: "Contact: security@cal.com". Note that this is the **commercial company's** address on a
  community fork's repo; SECURITY.md was only partly reworded for the fork ("At Cal.diy, we consider the security
  of our systems a top priority") and still speaks of "our clients", "our infrastructure or dashboard", i.e. a
  hosted service. Sending a Cal.diy self-host finding to security@cal.com may land with a team that does not own
  the fork. Belt and braces: use the GitHub private advisory on calcom/cal.diy AND cc security@cal.com.
- **Out-of-scope list** (quoted, relevant bullets):

  > "- Clickjacking on pages with no sensitive actions.
  >  - Unauthenticated/logout/login CSRF.
  >  - Attacks requiring MITM or physical access to a user's device.
  >  - **Any activity that could lead to the disruption of our service (DoS).**
  >  - Content spoofing and text injection issues without showing an attack vector ...
  >  - Email spoofing
  >  - Missing DNSSEC, CAA, CSP headers
  >  - Lack of Secure or HTTP only flag on non-sensitive cookies
  >  - Dead links"

  The DoS bullet reads as "do not run DoS against us", i.e. an exclusion on tester ACTIVITY, but a filer should
  expect it to be quoted back at any report whose only impact is resource exhaustion or availability denial.
  Frame availability-flavoured findings (unbounded reservation hold, unenforced rate limit) around the
  **authorization / documented-contract** breach first and the availability impact second.
- Reporter obligations (quoted): "Do not run automated scanners on our infrastructure or dashboard", "Do not take
  advantage of the vulnerability", "Do not reveal the problem to others until it has been resolved", "Do provide
  sufficient information to reproduce the problem".
- What they promise: "We will respond to your report within 3 business days with our evaluation of the report and
  an expected resolution date". No bug bounty, no HackerOne/huntr, no third-party platform is named.

### Evidence on how a public security PR fares

`calcom/cal.diy#29383` "fix(security): add ownership validation to prevent IDOR vulnerabilities" (community
author, 2026-05-17) was **closed unmerged the next day (2026-05-18) by `sahitya-chandra`, with no human review
comment** (only the welcome bot and the CLA bot commented). The tracker currently also carries fresh community
IDOR PRs (#30009, #30005, both opened 2026-08-19, both open). So a public security PR is not obviously the
productive path; the private advisory is.

## 2. calcom/cal.diy issue templates and CONTRIBUTING

`gh api repos/calcom/cal.diy/contents/.github/ISSUE_TEMPLATE` lists exactly three files:

| file | frontmatter |
|---|---|
| `bug_report.md` | `name: Bug report`, `about: Report any issues with the platform`, `title: ""`, `labels: ["🐛 bug"]`, `assignees: ""` |
| `feature_request.md` | `labels: ["✨ feature", "🚨 needs approval"]` |
| `config.yml` | `blank_issues_enabled: false`; one contact link, Questions -> https://github.com/calcom/cal.diy/discussions |

**`blank_issues_enabled: false`**: a bug MUST be filed through `bug_report.md`. Its required sections, in order,
are the shape the filed issue has to take:

- `### Issue Summary` ("a clear detailed-rich summary")
- `### Steps to Reproduce` (numbered)
- `### Actual Results` ("What's happening right now that is different from what is expected")
- `### Expected Results`
- `### Technical details` ("Browser version, screen recording, console logs, network requests ... Node.js version")
- `### Evidence` ("How was this tested? **This is quite mandatory in terms of bugs.** Providing evidence of your
  testing with screenshots or/and videos is an amazing way to prove the bug")

There is no version field and **no reproduction-repo requirement**, but the Evidence section is called mandatory,
so every filed issue needs a captured request/response, a log excerpt or a screenshot. No auto-title prefix: the
template sets `title: ""`. Recently filed bugs conventionally start the title with `[Bug]:` by hand
(e.g. #29951), which is not enforced anywhere.

`CONTRIBUTING.md` (https://github.com/calcom/cal.diy/blob/main/CONTRIBUTING.md), operative rules:

- Discussion-first applies to FEATURES ONLY:
  > "For feature requests, please wait for a core team member to approve and remove the `🚨 needs approval` label
  > before you start coding or submitting a PR."
  > "For bugs, security, performance, documentation, etc., you can start coding immediately, even if the
  > `🚨 needs approval` label is present."

  So a bug report or a bug-fix PR needs no prior approval. A behavior change dressed as a fix does.
- Dedupe first: "Before submitting a new issue or PR, check if it already exists in the Issues or Pull Requests."
- "Don't Just Drop a Link": no bare third-party links, the issue must stand on its own.
- PR hygiene: conventional-commit PR titles (enforced by the welcome bot's instruction), "Summarize Your PR at the
  Top", "Use GitHub Keywords to Auto-Link Issues" (`Closes #123`), "Mention What Was Tested (and How)",
  size limit "Keep PRs under 500 lines of code changed and under 10 code files modified".
- A **CLA is required** for PRs (CLAassistant bot, https://cla-assistant.io/calcom/cal.com). Filing an issue does not need one.
- Priority table: "Core Bugs (Login, Booking page, Emails not working)" -> `Urgent`;
  "Core Features (Booking page, availability, timezone calculation)" -> `High priority`;
  "Confusing UX (but still functional)" -> `Medium priority`. Availability, slots and booking-page defects are
  the repo's own top-priority buckets, worth stating in the issue.
- There is a `security` label on the repo.

### Tracker health (matters for the route choice)

- Bug issues do get triaged and labeled (`🐛 bug` appears on issues filed days earlier) and attract community
  contributors quickly (#29951 got 4 comments in a week, #29869 got 3).
- **Merges are rare and currently stalled.** `origin/main` head is 176037d0af, 2026-08-08, and has not moved in
  11 days. Of the 60 most recently closed PRs, only 12 were merged, and the last merge to main was #29940 on
  2026-08-08. On 2026-08-17..19 dozens of community PRs (a11y, small fixes, app-store additions) were closed
  unmerged in what looks like a triage sweep.
- Practical consequence: **prefer an issue over a PR.** An issue gets labeled and discussed; a drive-by PR has a
  low chance of being merged and can be closed within a day without comment.

## 3. Documentation repos

### calcom/help (product / help-centre docs, Mintlify)

- https://github.com/calcom/help , last push 2026-08-11, issues ENABLED, private vulnerability reporting disabled.
- **No SECURITY.md, no CONTRIBUTING.md, no `.github/ISSUE_TEMPLATE`, no PR template.** `community/profile`
  health is 25% and every `files` entry is null. `.github/` contains only `workflows/plain-mintlify-sitemap.yml`.
- Content is Mintlify `.mdx` under topic directories (`bookings/`, `availabilities/`, `event-types/`, ...) driven
  by `docs.json` (`"name": "Cal.com Help"`). Published at https://cal.com/help .
- How fixes are actually taken: **by PR, and almost all PRs are internal.** The 15 most recently updated PRs are
  either `mintlify[bot]` ("docs: Update from code changes: ...", generated from cal.com code changes) or Cal.com
  employees (`Udit-takkar`, `hariombalhara`). No community-authored doc PR appears in that window. Issues exist
  but are sparse (#126, open, from an employee).
- Route for a Cal.diy-found doc bug in the help centre: open an **issue** on calcom/help describing the wrong
  sentence and the correct one, with the published URL. A PR is acceptable (there is no CLA gate visible on that
  repo) but there is no template and no stated review SLA. Note the content documents the **commercial** product,
  so a fix that is only right for Cal.diy is not automatically right for the page.

### calcom/docs

- https://github.com/calcom/docs , last push **2024-10-09**, effectively dead. README, verbatim:

  > "THIS PROJECT IS NOW OBSOLETE.
  > For developer docs, add them to the Cal.com mono repo (https://github.com/calcom/cal.com) in the /docs folder.
  > They are hosted at https://cal.com/docs.
  > Our product docs are maintained by our support team and accessible at https://cal.com/help."

- **Do not file here.** Its own README redirects developer docs to the monorepo `/docs` folder, and that monorepo
  link now resolves to calcom/cal.diy (see section 0). Issues are technically open but stale since 2025 (open
  issues from 2024 with no replies).
- Practical mapping for API-reference doc bugs (C14/C15 class): the source of truth is
  `docs/api-reference/v2/openapi.json` plus the NestJS `@ApiOperation` descriptions in
  `apps/api/v2/src/**` inside **calcom/cal.diy**, so those are filed as normal cal.diy issues/PRs, not as
  calcom/docs issues.

## 4. Route decision table used for the C findings

| situation | route | policy sentence that drives it |
|---|---|---|
| Source defect in shipped Cal.diy code, no auth impact | public issue on calcom/cal.diy via `bug_report.md` | `config.yml` `blank_issues_enabled: false`; CONTRIBUTING "For bugs ... you can start coding immediately" |
| Missing authentication / authorization, IDOR, privilege bypass | private advisory at https://github.com/calcom/cal.diy/security/advisories/new plus email security@cal.com | SECURITY.md "E-mail your findings to security@cal.com"; private reporting enabled |
| Wrong sentence in the help centre | issue on calcom/help | no template, no CONTRIBUTING; PRs are bot/staff driven |
| Wrong sentence in the v2 API reference | issue (or PR) on calcom/cal.diy against `docs/api-reference/v2/openapi.json` / the controller decorator | calcom/docs README: "THIS PROJECT IS NOW OBSOLETE ... add them to the ... mono repo ... /docs folder" |
| Anything about the hosted Cal.com product | not filable from this work | commercial source is private; the public repo is the fork |
