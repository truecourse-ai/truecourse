# Order Management Service

Two-resource HTTP service (Orders + Customers) used as the end-to-end
fixture for the TrueCourse pipeline:

  docs/  →  consolidator  →  .truecourse/specs/  →  extractor  →  .truecourse/contracts/  →  verifier  →  drifts

The implementation under `code/` carries planted bugs (each annotated
with `// IL-DRIFT: <drift-key>`). The hand-written `reference/specs/`
and `reference/contracts/` corpus is the ground truth the verifier
compares the code against in `tests/contract-verifier/verify-end-to-end.test.ts`.

## Layout

- `docs/` — input documents (PRDs, ADRs) the consolidator reads
- `code/` — the implementation with planted bugs
- `reference/` — hand-written ideal specs + contracts (ground truth, committed)
- `.truecourse/` — generated specs + contracts (gitignored)
- `reference/EVAL.md` — prompt to evaluate generated output against the reference

## Planted bugs

Every planted bug is annotated in `code/` with a `// IL-DRIFT:` comment
whose payload is the exact drift key the verifier should emit, e.g.:

```ts
// IL-DRIFT: Operation:POST /api/orders / response.201
res.status(200);
```

The end-to-end test parses these markers and asserts the verifier's
drift set equals the marker set. To add or remove a planted bug, edit
the marker — the test auto-tracks.

<!-- PLANTED-CONFLICT vs PRDs/orders_PRDv2.md:
     This README still says "session cookie" (the v1-era scheme).
     PRDv2 + ADR 0001 say Bearer JWT. The consolidator should
     surface this as an auth-scheme conflict, with PRDv2/ADR-0001
     winning as the more-recent + ADR-backed claim. -->

Authentication uses a session cookie issued at login. All `/api/*`
endpoints require a valid session.

See `docs/PRDs/orders_PRDv2.md` for the current contract.
