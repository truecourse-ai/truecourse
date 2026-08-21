---
finding: F3
target: AmruthPillai/Reactive-Resume
route: public issue
title: "The Downloads statistic can never be non-zero: no code path ever increments it"
labels: "bug, status: needs triage (applied automatically by 1-bug-report.yml); suggested in body: v5, area: account"
status: filed
filed_url: https://github.com/AmruthPillai/Reactive-Resume/issues/3366
filed_at: 2026-08-20
format_note: "Matches .github/ISSUE_TEMPLATE/1-bug-report.yml exactly: every required `### ` header present and non-empty, in template order, with the required Existing-issue checkbox ticked. Dropdown sections carry only real option values (Product variant = Self-hosted; Area = Accounts & sharing). The optional `Template` section is omitted deliberately, since the bug is not template-specific and that field's options are template names only. `blank_issues_enabled: false` on this repo, so the form shape is mandatory. Own sub-headings demoted to ####."
reverified: "yes (main @ 3221afda9ddfb03d6cce87927b0ce47338b4cfa8, which is both the commit our corpus tested and today's default-branch head, so zero commits landed in between; live end-to-end re-run 2026-08-20 against an instance built from that commit: still reproduces, and the visitor verifiably receives the PDF)"
---

# The Downloads statistic can never be non-zero: no code path ever increments it

### Existing issue

- [x] I searched the existing issues and could not find a matching report.

Three keyword searches plus a local sweep of the 800 most recent issues and pull requests (back to 2026-01-23) turned up nothing about the downloads counter. The nearest neighbour is #3360 ("Sharing: Add a toggle to disable download feature"), which asks to suppress downloads rather than to count them, so it is not a duplicate, but it touches the same panel and may be worth linking.

### Product variant

Self-hosted

### Reactive Resume version

5.2.7 (commit `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`, 16 commits after the `v5.2.7` tag, so this exact build is not a release)

### Area

Accounts & sharing

### Environment

Chromium 141.0.7390.37 (headless, driven by `playwright-core` 1.62.1) on macOS (Darwin 25.5.0, arm64); self-hosted, built from source with `pnpm install --frozen-lockfile` and `pnpm run build`, run as `node apps/server/dist/index.mjs`, PostgreSQL 18 in Docker.

### Summary

The **Downloads** statistic is structurally incapable of moving. The sharing guide publishes it, `docs/guides/sharing-your-resume-publicly.mdx:90`:

> | **Downloads**       | Number of times a visitor downloaded your resume as a PDF        |

and the builder's Statistics panel ships the tile, its 30-day sparkline and a `Last downloaded on` caption. But nothing in the repository ever passes `downloads: true` to the increment helper, so the counter has no write path at all. It is not that this particular download went uncounted; no download can ever be counted.

We verified it end to end. An anonymous visitor with zero cookies opened the public resume page, pressed the page's own **Download PDF**, and really received the file (a genuine browser download event for `resume.pdf`, 241,590 bytes, first five bytes `%PDF-`), while `downloads` stayed `0` and `lastDownloadedAt` stayed `null`. In the same session `views` moved `0` to `1` and `lastViewedAt` moved from `null` to a timestamp, so the statistics pipeline itself is demonstrably working and only the download half is dead.

The increment used to exist: at tags `v5.0.0` and `v5.0.1` it was in the server-side printer router as `statistics.increment({ id: input.id, downloads: true })`, and that whole server-side printer path is absent from `v5.1.0` onward, which is consistent with PDF generation having moved to the client. So this looks like a regression that left the counter, its SQL, its output schema and its UI behind.

A note on the variant dropdown, since it only takes one value: we drove a **self-hosted** build, which is why the field says Self-hosted. The code involved is in the shared `packages/api` service with no deployment branch of any kind, so the cloud deployment runs the same path. Please do not read the dropdown as narrowing this to self-hosted installs.

### Steps to reproduce

1. Sign in, create a resume, and publish it from the Sharing panel so it has a public URL.
2. In a signed-out browser context (private window or a fresh profile, no cookies), open the public URL.
3. Look at the owner's **Statistics** panel in the builder, or call `GET /resumes/{id}/statistics`. **Views** is now 1 and **Last viewed** shows a timestamp. This is the control: it proves the resume, the request and the statistics path all work.
4. In the same signed-out context, press **Download PDF** on the public page and let the browser save the file. It arrives, and it is a real PDF.
5. Look at the Statistics panel again, or call `GET /resumes/{id}/statistics` again.
6. **Downloads** is still 0, there is no **Last downloaded on** caption, and `GET /resumes/{id}/statistics/daily` carries `downloads: 0` on every row.
7. Repeat step 4 as often as you like. The counter never moves.

Exact values from our run, resume `f3-82540078` published at `/guardowner/f3-82540078`:

```
stats BEFORE any visit:              {"isPublic":true,"views":0,"downloads":0,"lastViewedAt":null,"lastDownloadedAt":null}
visitor loaded public page; cookies: 0
stats AFTER visitor load (control):  {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}
'Download PDF' buttons on the public page: 2
browser download event:              download event: resume.pdf
downloaded file:                     241590 bytes, magic="%PDF-"
stats AFTER visitor Download PDF:    {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}
```

### Expected behavior

A visitor's download of a public resume increments `downloads` and sets `lastDownloadedAt`, so the Statistics panel reports what the sharing guide says it reports, and the daily table records it alongside views. The plumbing for this already exists and works: `resumeService.statistics.increment` accepts a `downloads` flag and has correct SQL for both the totals row and the daily row, and `access-policy.ts` already supplies the owner-exclusion helper for it ("Call sites that increment `views` / `downloads` should gate on this helper").

If counting a client-side export is genuinely not feasible now that PDF generation happens in the browser, the honest alternative is to stop publishing a metric that cannot move: remove the Downloads tile, its sparkline and the `Last downloaded on` caption, drop `downloads` from the statistics output schema, and correct `docs/guides/sharing-your-resume-publicly.mdx`. Either outcome is fine. The current state, a documented and prominently displayed metric that is permanently zero, is the one to avoid, because a user reads zero downloads as a fact about their resume rather than a fact about the code.

### Actual behavior

The counter stays at `0` and `lastDownloadedAt` stays `null` forever, while the visitor really does receive the PDF.

#### The control

Same endpoint, same resume, the same visitor session:

| counter | before | after the page load | after Download PDF |
| --- | --- | --- | --- |
| `views` | `0` | **`1`** | `1` |
| `lastViewedAt` | `null` | **`"2026-08-21T03:22:21.178Z"`** | `"2026-08-21T03:22:21.178Z"` |
| `downloads` | `0` | `0` | **`0`** |
| `lastDownloadedAt` | `null` | `null` | **`null`** |

Views moved beside the dead counters in the same session, on the same request path, so this is not a broken instance, a stale cache or an unsaved resume.

#### Cause

Read at `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`:

- `grep -rn "downloads: true" apps/ packages/` returns **0 matches**. Nothing in the product ever passes the flag.
- `grep -rn "statistics\.increment" apps/ packages/`, ignoring build output, returns three hits: `packages/api/src/features/resume/service.ts:550` and two in `service.test.ts` (`:887`, `:895`). All three pass `views: true`.
- The sole non-test call site, `packages/api/src/features/resume/service.ts:550`:

  ```ts
  await resumeService.statistics.increment({ id: resume.id, views: true });
  ```

- The implementation it would call is present and correct but unreachable. `service.ts:238-276` has working SQL for both counters:

  ```ts
  increment: async (input: { id: string; views?: boolean; downloads?: boolean }) => {
    const views = input.views ? 1 : 0;
    const downloads = input.downloads ? 1 : 0;
    const lastViewedAt = input.views ? sql`now()` : undefined;
    const lastDownloadedAt = input.downloads ? sql`now()` : undefined;
  ```

  `packages/db/src/schema/resume.ts:77-80` and `:103-104` carry the columns on both the totals and the daily table, and `packages/api/src/features/resume/statistics.ts:22` still publishes `downloads` in the procedure's output schema.
- `packages/api/src/features/resume/access-policy.ts:69-77` still carries a comment instructing call sites that increment `views` or `downloads` to gate on `shouldCountForStatistics`, a contract with no counterparty on the downloads side.
- The UI keeps rendering it: `apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/statistics.tsx:64-68` renders the Downloads tile, its series and the `Last downloaded on ${statistics.lastDownloadedAt.toDateString()}` caption.
- Regression anchor: at `v5.0.0` and `v5.0.1` the increment existed in `src/integrations/orpc/router/printer.ts` (`:27` at v5.0.0, `:22` at v5.0.1) as `statistics.increment({ id: input.id, downloads: true })`. That entire server-side printer path (`router/printer.ts`, `services/printer.ts`, `routes/printer/$resumeId.tsx`, `utils/printer-token.ts`) is absent from the tree at `v5.1.0` and every tag since. We did **not** pin the exact removal commit or PR number, so we are not claiming one; `git log -S "downloads: true" --all` on a full clone would settle it.

### Logs and screenshots

No screenshot is needed: every decisive value is a number in the statistics response, quoted above.

The public page emitted four `warning: Buffer is not defined` console warnings around the export. They are noise rather than a failed export, because the download completed and produced a valid 241,590 byte PDF, but they are recorded here in case they are useful.

The daily endpoint for the same resume returns rows of the form `{"date":"2026-07-23","views":0,"downloads":0}` for the full 30-day window, with `downloads` at 0 on every row.

#### Suggested labels

`bug`, `status: needs triage` (both applied by the form), plus `v5` and `area: account`. Our account cannot apply labels itself.

Deliberately **no** deployment label: the defect is in shared server code with no deployment branch, so narrowing it to either cloud or self-hosted would be wrong.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (the browser session, the download event record, the statistics responses and the downloaded PDF) is available on request.
