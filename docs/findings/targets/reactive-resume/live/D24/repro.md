# D24 — docs spell `Free-Form`; the app renders `Free-form`

**Re-run date:** 2026-08-20 · **Build:** `3221afda9ddfb03d6cce87927b0ce47338b4cfa8` (`main`, 16 commits past the `v5.2.7` tag, so none of this is in a release) ·
**Instance:** built from source for this re-run — `pnpm install --frozen-lockfile` + `pnpm run build`, `node apps/server/dist/index.mjs` on port **54490**, postgres from `reference/seed/compose.yml` (project `tc-rxresume`, port 54340), seeded with `reference/seed/guard-seed.mjs`.
**Browser probes:** `playwright-core@1.62.1` from `packages/guard-runner`. `chrome-headless-shell` rev 1234 is **absent** from this machine's `ms-playwright` cache, so these ran on **full Chromium rev 1194 (141.0.7390.37)** launched by `executablePath`.


**Doc quotes**, `docs/guides/selecting-page-format.mdx`:

> `:6` — Reactive Resume offers three page format options: **A4**, **Letter**, and **Free-Form**.
>
> `:32` — ### Free-Form

`grep -rno 'Free-Form' docs/` → **28 occurrences** across `selecting-page-format.mdx` and
`fitting-content-on-a-page.mdx`.

## Probe

The Page section's Format combobox, opened live:

```
=== D24 · PROBE: the Page section's Format combobox, opened live ===

format combobox trigger text                     A4
the three rendered options (verbatim)            ["A4","Letter","Free-form"]
page text contains "Free-Form" (doc spelling)    false
page text contains "Free-form" (rendered)        true
```

Screenshot: [`format-options.png`](./format-options.png).

## Control

The other two options — `A4` and `Letter` — match the guides **exactly**. That is what makes this a claim
about the spelling of the third option and not about the control.

## Mechanism, re-read at this SHA

```
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/page.tsx:130
  { value: "free-form", label: t`Free-form` },
apps/web/src/routes/builder/$resumeId/-sidebar/right/sections/page.tsx:122
  <Trans context="Page Format (A4, Letter, Free-form)">Format</Trans>
```

Even the translator-context string uses the lower-case `f`.

## Verdict

**still reproduces** — docs `Free-Form` (28 occurrences), product `Free-form`.
