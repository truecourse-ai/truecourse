# F3 — the `downloads` statistic has no write path

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/sharing-your-resume-publicly.mdx:90`:

> `| **Downloads**       | Number of times a visitor downloaded your resume as a PDF        |`

## Probe — end to end, an anonymous visitor really receives the file

The owner created a resume `withSampleData` over HTTP and published it. A browser context signed in to
nothing (`cookies: 0`) loaded `/guardowner/f3-<u>` and pressed the public page's own `Download PDF`,
with `acceptDownloads: true` so the browser's `download` event is observable.

```
F3 resume f3-82540078 (01a02257-4634-74f9-9e76-8bcc7784c47b) published at http://127.0.0.1:54490/guardowner/f3-82540078

F3 stats BEFORE any visit:              {"isPublic":true,"views":0,"downloads":0,"lastViewedAt":null,"lastDownloadedAt":null}
F3 visitor loaded public page; cookies: 0
F3 stats AFTER visitor load (control):  {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}
F3 'Download PDF' buttons on the public page: 2
F3 clicked Download PDF; page text now: f3-82540078 Game Developer | Unity & Unreal Engine Specialist Download PDF f3-82540078 Game Developer | Unity & Unreal Engine Specialist david.kowalski@email.com +1 (555) 291-4756 Seattle, WA davidkowalski.games github.c
F3 browser download event:              download event: resume.pdf
F3 downloaded file:                     241590 bytes, magic="%PDF-" -> /Users/musheghgevorgyan/repos/truecourse/docs/findings/targets/reactive-resume/live/F3/download-resume.pdf
F3 console warnings/errors:             ["warning: Buffer is not defined"] (total 4)
F3 stats AFTER visitor Download PDF:    {"isPublic":true,"views":1,"downloads":0,"lastViewedAt":"2026-08-21T03:22:21.178Z","lastDownloadedAt":null}
F3 daily statistics:                    [{"date":"2026-07-23","views":0,"downloads":0},{"date":"2026-07-24","views":0,"downloads":0},{"date":"2026-07-25","views":0,"downloads":0},{"date":"2026-07-26","views":0,"downloads":0},{"date":"2026-07-27","views":0,"downloads":0},{"date":"2026-07-28","views":0,"downloads":0},{"date":"2026-07-29","v

F3 VERDICT downloads / lastDownloadedAt: 0 / null
F3 CONTROL views / lastViewedAt:         1 / "2026-08-21T03:22:21.178Z"
```

### The download really arrived

The Playwright `download` event fired for **`resume.pdf`**. The file was saved and inspected:
**241,590 bytes**, first five bytes `%PDF-`. It is a genuine PDF, not a stub. Saved beside this file as
[`download-resume.pdf`](./download-resume.pdf); the event record is in
[`raw-f3.json`](./raw-f3.json) under `steps[].download`.

The four `warning: Buffer is not defined` console warnings are present and are noise: the export they
accompany completed and delivered a valid PDF.

## Control — the statistics path works, only the download half is dead

Same endpoint, same resume, **the same visitor session**:

| counter | before | after the load | after `Download PDF` |
| --- | --- | --- | --- |
| `views` | `0` | **`1`** | `1` |
| `lastViewedAt` | `null` | **`"2026-08-21T03:22:21.178Z"`** | `"2026-08-21T03:22:21.178Z"` |
| `downloads` | `0` | `0` | **`0`** |
| `lastDownloadedAt` | `null` | `null` | **`null`** |

`views` and `lastViewedAt` moved beside the dead counters in the same session, so the statistics
pipeline, the resume, the request and the reader are all demonstrably working. The daily table
(`GET /resumes/{id}/statistics/daily`) likewise carries `downloads: 0` on every row.

## Mechanism, re-read at this SHA

- `grep -rn "downloads: true" apps/ packages/` → **0 matches**. Nothing in the product ever passes the flag.
- `grep -rn "statistics\.increment" apps/ packages/` → three hits: `service.ts:550`, and `service.test.ts:887`/`:895` — all three pass `views: true`.
- The sole call site, `packages/api/src/features/resume/service.ts:550`:
  ```ts
  await resumeService.statistics.increment({ id: resume.id, views: true });
  ```
- `service.ts:238-276` still carries working SQL for **both** counters; `statistics.ts:22` still publishes
  `downloads` in the procedure's output schema. The implementation exists and is unreachable.
- The regression is anchored in git: the increment existed at **v5.0.0** and **v5.0.1** in
  `src/integrations/orpc/router/printer.ts` as `statistics.increment({ id: input.id, downloads: true })`,
  and that whole server-side printer path is absent from **v5.1.0** onward.

## Verdict

**still reproduces** — and end to end. The visitor verifiably receives `resume.pdf` (a real `download`
event, 241,590 bytes of valid PDF) while `downloads` stays `0` and `lastDownloadedAt` stays `null`, with
`views`/`lastViewedAt` moving in the same session as the control.
