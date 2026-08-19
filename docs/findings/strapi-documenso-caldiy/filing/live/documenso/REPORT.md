# Documenso live re-verification report

Date: 2026-08-19. Build: `documenso/documenso` `main` @ **`75330166cc00b29c14399bc2e391e4b4d8080c00`**, commit date 2026-08-19 20:34:18 +1000, tag **v2.17.0**. This is the sha recorded in `filing/STATE.md`; upstream has not moved since.

The findings were recorded against v2.16.0 (`3cf2963cd03d8b24770b7490bdb20e596baa5d65`). Everything below was reproduced by hand against a fresh local build of v2.17.0, not by re-running the guard.

## Results

| id | verdict | one-line evidence | evidence path |
|---|---|---|---|
| D1 | still reproduces | On a PENDING envelope: recipient create 200, recipient update 200, recipient delete 200, field create 200, field update 200, field delete 200, envelope rename 200; only `envelope/item/delete` refuses (400 `Envelope item is not editable`) | `D1/repro.md` |
| D2a | still reproduces | `field/update-many` with `positionY: 60` returns 200 and `"positionY":"20"`; even a full-coordinate body moves nothing | `D2a/repro.md` |
| D2b | still reproduces | The same call replaces `{label:"Job Title", placeholder:"...", required:true, characterLimit:40}` with type defaults, silently, on a 200 | `D2b/repro.md` |
| D3 | still reproduces | `role: "ASSISTANT"` accepted with 200 on a PARALLEL envelope, both by default and with PARALLEL set explicitly; the created recipient carries `signingOrder: null` | `D3/repro.md` |
| D4 | still reproduces | Reject returns 200; the envelope still reads `PENDING` 12 ms and 112 ms later, and flips to `REJECTED` at 52 ms in one run, 638 ms in another | `D4/repro.md` |
| D5 | still reproduces | All **nine** forbidden `fieldMeta` configurations accepted with 200 and persisted (the original run only ever observed the first) | `D5/repro.md` |
| D6 | **fixed** | `x-ratelimit-limit: 1000` on v2.17.0, with and without `DANGEROUS_BYPASS_RATE_LIMITS`; PR #3081 is now in a release, and #3133 removed the contradictory docs callout | `D6/repro.md` |
| D7 | still reproduces | After a None send the document page carries no `/sign/` in text, in any `<a href>`, or in any input; the redirect carries `?action=copy-links`, captured live | `D7/repro.md` |
| D8 | still reproduces | `getByRole('combobox', {name:'Expires in'}).count() === 0`; the label's `htmlFor="_r_f_-form-item"` points at no element; options read `7 days, 1 month, 3 months, 6 months, 12 months, Never` | `D8/repro.md` |
| D9 | still reproduces | The copy control and `document-page-view-action-btn` both snapshot as a bare `- button`; 5 of 9 buttons on the page have an empty accessible name | `D9/repro.md` |
| D10 | still reproduces | No `error` and no top-level `statusCode` on any tRPC v2 error; 404 and 401 both carry top-level `code: "INTERNAL_SERVER_ERROR"` | `D10/repro.md` |
| D11 | still reproduces | Coordinates sent as numbers come back as `"10"`, `"80"`, `"20"`, `"5"`; only `page` stays a number | `D11/repro.md` |
| D13 | **fixed** | `documents.mdx` in v2.17.0 documents `{ids:{type,ids}}` with the 1-20 cap; `envelopeIds` no longer appears in the file (PR #3135) | `D13/repro.md` |
| D14 | still reproduces (scope reduced) | Wire keys are `data, count, currentPage, perPage, totalPages`; `documents.mdx` is fixed but `first-api-call.mdx` L81-86 still publishes the `pagination` wrapper | `D14/repro.md` |
| D15 | still reproduces | Outsider token on the owner's envelope -> 404 `Envelope could not be found`, while the owner reads the same envelope with 200 | `D15/repro.md` |

Not attempted: D12, D16 (pure doc findings outside the minimum and extras list), D17 (routed as a test defect).

## How the instance was built

```bash
git clone --depth 1 --branch main https://github.com/documenso/documenso.git
# HEAD 75330166cc00b29c14399bc2e391e4b4d8080c00, tag v2.17.0
npm ci                                            # node v24.14.1, npm 11.11.0
npm run prisma:generate
npm run prisma:migrate-deploy
npx turbo run build --filter=@documenso/remix     # 1 min 55 s
PORT=3347 npm run start -w @documenso/remix       # health GET /api/health -> 200
```

Environment (a `.env` at the repo root and a copy at `apps/remix/.env`, because `npm run with:env` reads `.env` relative to the workspace it runs in):

```
NEXT_PRIVATE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/tc_reverify_documenso
NEXT_PRIVATE_DIRECT_DATABASE_URL=(same)
NEXTAUTH_SECRET=guard-reference-nextauth-secret
NEXT_PRIVATE_ENCRYPTION_KEY=CAFEBABE
NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY=DEADBEEF
NEXT_PUBLIC_UPLOAD_TRANSPORT=database
NEXT_PRIVATE_JOBS_PROVIDER=local
NEXT_PRIVATE_SIGNING_TRANSPORT=local
NEXT_PRIVATE_SIGNING_LOCAL_FILE_PATH=./example/cert.p12      # apps/remix/example/cert.p12
NEXT_PRIVATE_SMTP_TRANSPORT=smtp-auth
NEXT_PRIVATE_SMTP_HOST=127.0.0.1
NEXT_PRIVATE_SMTP_PORT=2500
NEXT_PRIVATE_SMTP_UNSAFE_IGNORE_TLS=true
DOCUMENSO_DISABLE_TELEMETRY=true
NEXT_PUBLIC_WEBAPP_URL=http://localhost:3347
NEXT_PRIVATE_INTERNAL_WEBAPP_URL=http://localhost:3347
PORT=3347
```

`DANGEROUS_BYPASS_RATE_LIMITS` was deliberately **not** set for the whole run, per the brief. It was added for one restart at the very end to record the D6 headers the other way, then the server was stopped.

Deviations from the recipe, and why:

- Database: the recipe's docker-compose Postgres on port 54320 was replaced by the machine's local Postgres 17.4, database **`tc_reverify_documenso`**, role `postgres`. Docker is not running on this machine and the brief forbids starting it. The database is left in place; it is small and is the only database created.
- Mail: no mail catcher exists here, so a small node `net` SMTP sink was run on 127.0.0.1:2500 to speak enough SMTP (EHLO, AUTH LOGIN/PLAIN, MAIL, RCPT, DATA) to accept and discard messages. All the scenarios reproduced here use `distributionMethod: NONE`, so this only absorbed incidental mail and never gated anything.
- Browser: `playwright-core` 1.62.1 from `packages/guard-runner` expects `chromium_headless_shell-1234`, which is not installed. The installed `chromium-1194` full build was used instead through `executablePath`, headless. No browser was downloaded (disk).

## Seeding

The original run's `reference/seed/guard-seed.mjs` is not on this machine, so seeding was done with a small `tsx` script inside the repo, using the product's own helpers:

- `packages/prisma/seed/users.ts` `seedUser()` for **guard-owner@documenso.test / GuardOwner1!** (user 3, team 3, team url set to `guard-owner`) and **guard-outsider@documenso.test / GuardOutsider1!** (user 4, team 4, team url `guard-outsider`), each with its own organisation.
- `packages/lib/server-only/public-api/create-api-token.ts` `createApiToken()` for one never-expiring API token per account.
- A hand-built source TEMPLATE envelope, "Guard Source Template", `internalVersion: 2`, `signatureLevel: SES`, one envelope item holding `assets/example.pdf` (39 842 bytes) as a `BYTES_64` `DocumentData` row. `seedTemplate()` was not reused directly because it always attaches a "Recipient 1" recipient, and the original guard template had none. This template is what `POST /api/v2/envelope/use` mints from, which is how each scenario gets a PDF-bearing envelope without a multipart file part.

All API calls used the owner token verbatim in the `Authorization` header (no `Bearer`), which is what the v2 OpenAPI scheme declares and what the scenario headers show.

## Problems hit

- The playwright chromium build the environment note assumed (`chromium-1234`) is absent; worked around with `executablePath` on `chromium-1194`. No functional impact.
- `?action=copy-links` on the D7 redirect is stripped by `document-page-view-recipients.tsx` within a few hundred milliseconds, so a plain URL read after the page settles never sees it. Captured by patching `history.pushState` / `replaceState` from an init script before the click. Recorded in `D7/redirect-url-capture.json`.
- D1's scenario step 9 (recipient delete) cascades the recipient's fields away, which made steps 10 and 13 fail with `Recipient 4 not found` / `Field with id 4 not found` rather than with the freeze. A second pass on a fresh envelope, keeping the recipient alive, was run to test the field freeze honestly. Both passes are in `D1/`.

## What should change a finding's confidence or scope

1. **D1 grows.** The freeze is unenforced for recipient create, recipient update, recipient delete, field create, field update, field delete and envelope rename. Only `envelope/item/delete` refuses. Two observed consequences worth putting in a filing: changing a recipient's email leaves the signing token unchanged, so the link already handed out now resolves to a recipient carrying a different address; and deleting a recipient cascades their SIGNATURE field away, leaving a sent document without the field it was sent to collect. The review's caveat that steps 8 to 12 were source-level inference can be dropped.
2. **D5 grows.** All nine forbidden `fieldMeta` configurations are now observed, not one. The uniform 200 across nine unrelated rules is direct evidence that no `fieldMeta` validation runs on the v2 create path at all. The review's "report only the TEXT case as observed" caveat can be dropped.
3. **D9 converts from source reading to observation.** The accessibility tree was read directly; a filing may now say a screen-reader-equivalent probe was performed.
4. **D8 gains its second half.** The "12 months" vs "1 year" wording mismatch, previously unobserved because the accessibility wall blocked the step, is now recorded with the full option list.
5. **D2a is slightly stronger than reviewed.** The coordinate no-op is not confined to partial bodies: a body carrying `page`, `positionX`, `positionY`, `width` and `height` together also moves nothing, so there is no accidental workaround.
6. **D4 should be reframed.** The stale read reproduces, but the window here is 12 to 638 ms, shorter than the original run's 200 to 400 ms lower bound suggested. Lead a filing with the correctness half (during the window the envelope is still PENDING and the "other pending recipients can no longer act" promise is unenforced), not with the latency. Note in the filer's favour that the recipient row is authoritative immediately.
7. **D6 is closed.** Do not file. Both halves shipped on 2026-08-19 (#3081 in v2.17.0, #3133 for the docs callout).
8. **D13 is closed.** Do not file. `documents.mdx` in v2.17.0 already documents the real contract.
9. **D14 shrinks.** Its bound page `documents.mdx` is fixed; what remains is `first-api-call.mdx`, `templates.mdx`, `teams.mdx` and `common-workflows.mdx`. Do not describe the finding as "documents.mdx is wrong".
10. **D10, D11, D15, D3, D2b, D7** are unchanged in verdict, confidence and scope.

## Cleanup

- The clone, its `node_modules` and its build outputs under `scratchpad/build/documenso` were deleted after the evidence was written.
- The database **`tc_reverify_documenso`** on 127.0.0.1:5432 was left in place, as the brief instructs.
- The two processes started for this run (the documenso server on 3347 and the SMTP sink on 2500) were stopped. Nothing else on the machine was started, stopped or modified.
