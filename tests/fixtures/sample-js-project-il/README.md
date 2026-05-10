# Order Management Service

Two-resource HTTP service (Orders + Customers) used as the end-to-end
fixture for the TrueCourse pipeline:

  docs/  →  consolidator  →  .truecourse/spec/  →  extractor  →  .truecourse/contracts/  →  verifier  →  drifts

The implementation under `code/` carries planted IL-DRIFT bugs (each
marked with `// IL-DRIFT:`). The hand-written `.truecourse/contracts/`
corpus is the ground truth the verifier compares the code against.

<!-- PLANTED-CONFLICT vs PRDs/orders_PRDv2.md:
     This README still says "session cookie" (the v1-era scheme).
     PRDv2 + ADR 0001 say Bearer JWT. The consolidator should
     surface this as an auth-scheme conflict, with PRDv2/ADR-0001
     winning as the more-recent + ADR-backed claim. -->

Authentication uses a session cookie issued at login. All `/api/*`
endpoints require a valid session.

See `docs/PRDs/orders_PRDv2.md` for the current contract.
