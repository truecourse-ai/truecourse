---
finding: D2
target: AmruthPillai/Reactive-Resume
route: public issue
title: "The download dialog closes the instant an export starts, so the spinner and disabled states the export guide describes can never be seen"
labels: "bug, status: needs triage (applied automatically by 1-bug-report.yml); suggested in body: v5, area: builder"
status: blocked
blocked_reason: The live run does not demonstrate the claim and contradicts itself. The download fired at t=171 ms and the first observation is t=179 ms, so there is NO sample during the export; every sampled row is post-export. The repro also asserts "the dialog was absent when the file arrived" while its own table shows the dialog open from 179 to 288 ms. What the run shows is the dialog lingering about 145 ms AFTER the file arrived with buttons enabled and no spinner, which is not "closes the instant an export starts". Do not file until either (a) a re-run samples during the export, by slowing the export with a larger resume or CPU throttling so it exceeds the ~28 ms poll interval, or (b) the report is reframed as a pure code-level finding that the spinner at :133 and the guards at :141/:159/:177 are unreachable, dropping the timing claim entirely.
reverified: "yes (main @ 3221afda9ddfb03d6cce87927b0ce47338b4cfa8, which is both the commit our corpus tested and today's default-branch head, so zero commits landed in between; live re-run 2026-08-20 against a self-hosted instance built from that commit, polled every ~25 ms for 2.5 s: still reproduces, on a machine fast enough to make the window even shorter)"
format_note: "Matches .github/ISSUE_TEMPLATE/1-bug-report.yml exactly: every required `### ` header present and non-empty, in template order, with the required Existing-issue checkbox ticked. Dropdown sections carry only real option values, verified against the live template on 2026-08-21 (Product variant = Self-hosted; Area = Templates, preview & export). The optional `Template` section is omitted deliberately: the dialog is template-independent. `blank_issues_enabled: false` on this repo, so the form shape is mandatory. Own sub-headings demoted to ####."
---

# The download dialog closes the instant an export starts, so the spinner and disabled states the export guide describes can never be seen

### Existing issue

- [x] I searched the existing issues and could not find a matching report.

Keyword searches for the download dialog, the spinner and the disabled state, plus a sweep of the 800 most recent issues and pull requests, found nothing on this. The download-related issues from the last seven months are about PDF content or export failures, not about the dialog's feedback.

### Product variant

Self-hosted

### Reactive Resume version

5.2.7 (commit `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` on `main`, 16 commits after the `v5.2.7` tag, so this exact build is not a release)

### Area

Templates, preview & export

### Environment

Chromium 141.0.7390.37 (headless, driven by `playwright-core` 1.62.1 with downloads accepted) on macOS (Darwin 25.5.0, arm64); self-hosted, built from source with `pnpm install --frozen-lockfile` and `pnpm run build`, run as `node apps/server/dist/index.mjs`, PostgreSQL 18 in Docker.

### Summary

The export guide documents in-progress feedback on the download dialog, `docs/guides/exporting-your-resume.mdx:38`:

> While an export is running, the trigger button and format buttons show a spinner and stay disabled until the file is ready.

Neither state is observable, because the dialog closes before the export is invoked. The dialog's `run()` helper calls `setOpen(false)` and only then starts the export, so the format buttons begin unmounting immediately and the `isExporting` state they are bound to has no component left to render into.

This is not a documentation mismatch. The spinner and all three disabled guards are really in the file, written deliberately, and one line above them defeats them. Somebody intended exactly the behaviour the guide describes.

What we measured. From the click on **Download PDF**, sampled every ~25 ms for 2.5 s:

- The format buttons are **never disabled**. For the roughly 290 ms they survive (the dialog's exit animation) every single sample reads `disabled: false`.
- The dialog **never carries a spinner**. Every sample reads `spinner: false`.
- By **316 ms** the dialog is gone and there is no format button on the page at all. The last sample at which any format button existed is **288 ms**.
- The dialog was **absent when the file arrived**.

One honest note about timing. This machine produced the PDF in **171 ms**, where an earlier pass of ours on slower hardware recorded 823 ms. That changes the arithmetic and not the finding: the states the guide describes are unobservable because their component is unmounted, not because the export happens to be quick. On this faster machine the buttons were still enabled for the entire time they existed.

### Steps to reproduce

1. Sign in and open a resume in the builder.
2. Press **Download options** to open the Download dialog. Confirm the control first: all four format rows are present and enabled (`Download PDF`, `Download DOCX`, `Download Markdown`, `Download JSON`, each `present: 1 / disabled: false`).
3. Press **Download PDF**.
4. Watch the dialog, or better, sample it programmatically. It begins closing at once. No format button ever becomes disabled and no spinner ever appears.
5. The PDF arrives with the dialog already gone.

Verbatim from our run, resume `d2-82888714`. The dialog contents before the press:

```
- heading "Download" [level=2]
- heading "PDF"      … - button "Download PDF"
- heading "DOCX"     … - button "Download DOCX"
- heading "Markdown" … - button "Download Markdown"
- heading "JSON"     … - button "Download JSON"

BEFORE  button "Download PDF"       present / disabled : 1 / false
BEFORE  button "Download DOCX"      present / disabled : 1 / false
BEFORE  button "Download Markdown"  present / disabled : 1 / false
BEFORE  button "Download JSON"      present / disabled : 1 / false
```

The polling table after pressing `Download PDF`, tracking `Download DOCX` as the sibling that should have gone disabled (rows abridged after the dialog is gone; the pattern holds unchanged to 2481 ms):

```
t(ms) | dialog | "Download DOCX" present | its disabled state | spinner
  179 | open   | yes                     | false              | false
  207 | open   | yes                     | false              | false
  234 | open   | yes                     | false              | false
  262 | open   | yes                     | false              | false
  288 | open   | yes                     | false              | false
  316 | GONE   | no                      | null               | false
  343 | GONE   | no                      | null               | false
  …
 2481 | GONE   | no                      | null               | false

download arrived at t=171 ms, file d2-82888714.pdf
dialog present when the file arrived: 0

any sample where a format button was disabled? false
any sample where the dialog carried a spinner?  false
last t(ms) at which a format button existed:    288
```

#### The control

Step 2 is the control, and it is what makes the probe meaningful: before the press, all four format buttons exist and are enabled. So the polling is measuring a real disappearance rather than a dialog that never opened or a button that was never there.

### Expected behavior

What the guide says: while an export is running, the trigger button and the format buttons show a spinner and stay disabled until the file is ready. The code to do this already exists and needs only to be given a component that is still mounted.

The smallest fix that matches the documented behaviour is to stop closing the dialog up front, and let the existing `isExporting` state do the job it was written for: keep the dialog open while the export runs, then close it when the export settles (or leave it open and let the user close it, which also makes an export failure visible in the place the user is looking).

If closing immediately is the intended product behaviour, then the opposite change is the honest one: remove the spinner branch and the three `disabled={isExporting}` guards, since they are unreachable, and correct `docs/guides/exporting-your-resume.mdx:38` so it no longer promises feedback the user cannot see. Either resolution is fine. The current state, where the feedback is documented, written, and structurally unreachable, is the one to avoid.

### Actual behavior

The dialog closes the moment a format button is pressed. The buttons read `disabled: false` at every sample for the roughly 290 ms they survive, no spinner ever appears, the dialog is gone by 316 ms, and the file arrives with nothing on screen to say an export was ever running.

#### Cause

Read at `3221afda9ddfb03d6cce87927b0ce47338b4cfa8`, `apps/web/src/features/resume/export/download-dialog.tsx:77-80`:

```tsx
const run = (action: () => void | Promise<void>) => {
	setOpen(false);
	void action();
};
```

https://github.com/AmruthPillai/Reactive-Resume/blob/3221afda9ddfb03d6cce87927b0ce47338b4cfa8/apps/web/src/features/resume/export/download-dialog.tsx#L77-L80

The dialog is closed before the export is invoked. Everything the guide describes is written just below it and is unreachable for that reason:

- `:133` renders the spinner: `isExporting ? <CircleNotchIcon className="size-5 animate-spin" /> : <FilePdfIcon …/>`
- `disabled={isExporting}` at `:141` (PDF), `:159` (DOCX) and `:177` (Markdown)

One cite correction, since we checked it directly: the JSON button near `:196` is guarded by `disabled={jsonDisabled}`, not by `isExporting`, so it is not part of this.

A note on the variant dropdown, since it takes only one value: we drove a **self-hosted** build. This is client-side code with no deployment branch, so the cloud deployment renders the identical component. Please do not read the dropdown as narrowing this to self-hosted installs.

### Logs and screenshots

A screenshot cannot show this well, which is why the polling table above is the evidence: what has to be demonstrated is the absence of a state over time, and the decisive lines are `any sample where a format button was disabled? false` and `any sample where the dialog carried a spinner? false`.

The export itself succeeded: a real PDF arrived as `d2-82888714.pdf` at 171 ms. No error was logged at any layer, since nothing failed. The behaviour is a race the code sets up with itself.

#### Suggested labels

`bug`, `status: needs triage` (both applied by the form), plus `v5` and `area: builder`. Our account cannot apply labels itself.

Deliberately **no** deployment label: this is client-side code with no deployment branch, so narrowing it to either cloud or self-hosted would be wrong.

Found by TrueCourse running the product's published documentation against a live instance; the full transcript (the browser session, the complete polling series, the console output and the download event record) is available on request.
