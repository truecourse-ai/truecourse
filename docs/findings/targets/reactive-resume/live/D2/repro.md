# D2 — the download dialog closes before the export starts

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quote**, `docs/guides/exporting-your-resume.mdx:38`:

> While an export is running, the trigger button and format buttons show a spinner and stay disabled until the file is ready.

## Probe

The dialog was opened, all four format rows confirmed present and enabled (the control), then
`Download PDF` was pressed and the page polled every ~25 ms for 2.5 s.

```
=== D2 · PROBE: the download dialog ===

  - heading "Download" [level=2]
  - heading "PDF" [level=3]
  - button "Download PDF":
  - heading "DOCX" [level=3]
  - button "Download DOCX":
  - heading "Markdown" [level=3]
  - button "Download Markdown":
  - heading "JSON" [level=3]
  - button "Download JSON":

BEFORE  button "Download PDF"       present / disabled : 1 / false
BEFORE  button "Download DOCX"      present / disabled : 1 / false
BEFORE  button "Download Markdown"  present / disabled : 1 / false
BEFORE  button "Download JSON"      present / disabled : 1 / false

t(ms) | dialog | "Download DOCX" present | its disabled state | spinner
  179 | open   | yes                     | false              | false
  207 | open   | yes                     | false              | false
  234 | open   | yes                     | false              | false
  262 | open   | yes                     | false              | false
  288 | open   | yes                     | false              | false
  316 | GONE   | no                      | null               | false
  343 | GONE   | no                      | null               | false
  370 | GONE   | no                      | null               | false
  398 | GONE   | no                      | null               | false
  425 | GONE   | no                      | null               | false
  454 | GONE   | no                      | null               | false
  484 | GONE   | no                      | null               | false
  511 | GONE   | no                      | null               | false
  541 | GONE   | no                      | null               | false
  573 | GONE   | no                      | null               | false
  606 | GONE   | no                      | null               | false
  638 | GONE   | no                      | null               | false
  667 | GONE   | no                      | null               | false
  694 | GONE   | no                      | null               | false
  724 | GONE   | no                      | null               | false
  754 | GONE   | no                      | null               | false
  783 | GONE   | no                      | null               | false
  811 | GONE   | no                      | null               | false
  839 | GONE   | no                      | null               | false
  868 | GONE   | no                      | null               | false
  897 | GONE   | no                      | null               | false
  924 | GONE   | no                      | null               | false
  952 | GONE   | no                      | null               | false
  978 | GONE   | no                      | null               | false
 1004 | GONE   | no                      | null               | false
 1032 | GONE   | no                      | null               | false
 1059 | GONE   | no                      | null               | false
 1088 | GONE   | no                      | null               | false
 1117 | GONE   | no                      | null               | false
 1146 | GONE   | no                      | null               | false
 1191 | GONE   | no                      | null               | false
 1222 | GONE   | no                      | null               | false
 1251 | GONE   | no                      | null               | false
 1281 | GONE   | no                      | null               | false
 1312 | GONE   | no                      | null               | false
 1340 | GONE   | no                      | null               | false
 1372 | GONE   | no                      | null               | false
 1403 | GONE   | no                      | null               | false
 1432 | GONE   | no                      | null               | false
 1461 | GONE   | no                      | null               | false
 1490 | GONE   | no                      | null               | false
 1519 | GONE   | no                      | null               | false
 1550 | GONE   | no                      | null               | false
 1580 | GONE   | no                      | null               | false
 1613 | GONE   | no                      | null               | false
 1646 | GONE   | no                      | null               | false
 1678 | GONE   | no                      | null               | false
 1710 | GONE   | no                      | null               | false
 1742 | GONE   | no                      | null               | false
 1770 | GONE   | no                      | null               | false
 1798 | GONE   | no                      | null               | false
 1831 | GONE   | no                      | null               | false
 1860 | GONE   | no                      | null               | false
 1890 | GONE   | no                      | null               | false
 1922 | GONE   | no                      | null               | false
 1951 | GONE   | no                      | null               | false
 1982 | GONE   | no                      | null               | false
 2010 | GONE   | no                      | null               | false
 2037 | GONE   | no                      | null               | false
 2064 | GONE   | no                      | null               | false
 2092 | GONE   | no                      | null               | false
 2122 | GONE   | no                      | null               | false
 2154 | GONE   | no                      | null               | false
 2186 | GONE   | no                      | null               | false
 2218 | GONE   | no                      | null               | false
 2247 | GONE   | no                      | null               | false
 2275 | GONE   | no                      | null               | false
 2303 | GONE   | no                      | null               | false
 2331 | GONE   | no                      | null               | false
 2360 | GONE   | no                      | null               | false
 2387 | GONE   | no                      | null               | false
 2415 | GONE   | no                      | null               | false
 2449 | GONE   | no                      | null               | false
 2481 | GONE   | no                      | null               | false

download arrived at t=171 ms — d2-82888714.pdf
dialog present when the file arrived: 0

any sample where a format button was disabled? false
any sample where the dialog carried a spinner?  false
last t(ms) at which a format button existed:    288
```

## What reproduced

- The format buttons are **never disabled**: for the ~290 ms they survive (the dialog's exit animation)
  every sample reads `disabled: false`.
- The dialog **never carries a spinner**: every sample reads `spinner: false`.
- By **316 ms** the dialog is gone and there is no format button on the page at all.
- The dialog was **absent when the file arrived**.

This machine generated the PDF faster than the original pass (171 ms here versus 823 ms there), which
changes the arithmetic but not the finding: the states the guide describes are unobservable because
their component is unmounted, not because the export is quick. On this faster machine the buttons were
still enabled for the entire time they existed.

## Control

Before the press, all four buttons exist and are enabled:
`Download PDF`, `Download DOCX`, `Download Markdown`, `Download JSON` — each `present: 1 / disabled: false`.
So the probe measures a real disappearance, not a missing dialog.

## Mechanism, re-read at this SHA

`apps/web/src/features/resume/export/download-dialog.tsx:77-80`:

```tsx
const run = (action: () => void | Promise<void>) => {
	setOpen(false);
	void action();
};
```

The dialog is closed *before* the export is invoked. The states the doc describes are real and
structurally unreachable: the spinner at `:133`
(`isExporting ? <CircleNotchIcon className="size-5 animate-spin" /> : <FilePdfIcon …/>`) and
`disabled={isExporting}` at `:141` (PDF), `:159` (DOCX) and `:177` (Markdown). The JSON button near `:196`
is guarded by `disabled={jsonDisabled}`, not by `isExporting` — confirmed at this SHA, correcting the
hand-verification report's `:141, :159, :178, :196`.

## Verdict

**still reproduces**
