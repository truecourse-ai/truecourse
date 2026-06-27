# Battle-test expectations — Slate scheduling SaaS

A deliberately-independent fixture for the corpus `spec scan` → `contracts generate`
pipeline (a different domain from `sample-*-il`, to catch overfitting). The docs
are realistic; each plants a specific hard case with a KNOWN-correct outcome.
There is no golden `.tc` set — assert the planted outcomes below against the
produced `corpus.json` + `.truecourse/contracts/`.

Run:
```
cd <copy of this fixture>           # git-init so the CLI git-guard passes
truecourse spec scan                # → corpus.json
truecourse contracts generate       # → .tc
```

## Docs (10)
| doc | role |
|---|---|
| `README.md` | both products; Appointment base fields; **24h** cancellation |
| `docs/prd/booking-app-v1.md` | **superseded**; 24h; no reschedule |
| `docs/prd/booking-app-v2.md` | current; **48h**; reschedule; extra Appointment fields |
| `docs/prd/ops-console.md` | ops product; agent flows; agent `appointment.created` |
| `docs/adr/0001-auth.md` | JWT (booking) + Okta SSO (ops) |
| `docs/adr/0002-data-store.md` | Postgres + transactional outbox |
| `docs/adr/0003-timezones.md` | store UTC, render IANA tz |
| `docs/notes/sprint-42-tasks.md` | **noise** — task board |
| `docs/notes/vendor-sms-research.md` | **noise** — external vendor research |
| `docs/notes/goals.md` | **process** — goals / non-goals / open-questions |

## SCAN expectations (corpus.json)

- **S1 — relevance drops noise.** `sprint-42-tasks.md` and `vendor-sms-research.md`
  are dropped (`skippedDocs` / not in any area). They describe TODOs / a third-party
  system, not our contracts.
- **S2 — version chain.** `booking-app-v1.md` does NOT contribute downstream —
  either dropped as superseded by relevance, or a `replace` relation
  `v1 → v2` excludes it. (Either mechanism is acceptable; the outcome is v1 gone.)
- **S3 — MULTI-PRODUCT kept separate (the headline test).** The corpus has **≥2
  products** — a `booking-app` (README + booking PRDs) and an `ops-console`
  (ops PRD) — NOT collapsed into one `core`. Booking endpoints and ops endpoints
  live in DIFFERENT areas. (This is the inverse of the js-il over-split: here the
  split is correct because they are genuinely separate apps.)
- **S4 — ADR recall.** All three ADRs get ≥1 area (none left untagged): auth →
  an `auth` area, data-store → persistence/architecture, timezones →
  architecture/time.
- **S5 — process bucket.** `goals.md` is tagged `process/*` (goals / non-goals /
  open-questions) and contributes no contracts.
- **S6 — overlap flagged.** README (cancellation **24h**) and `booking-app-v2`
  (cancellation **48h**) are two CURRENT docs that disagree → an overlap is
  flagged between them in the booking cancellation/appointment area.

## GENERATE expectations (.tc)

- **G1 — valid corpus.** Generate writes contracts (`write.written > 0`), does NOT
  resolver-hard-abort, and the run reports few/no gaps for the booking + ops spine.
- **G2 — ONE Appointment entity, merged across docs.** A single `Appointment`
  entity (booking-app product) whose fields are the UNION of README's base set
  (`id, providerId, customerId, startsAt, status`) AND v2's extensions
  (`rescheduleCount, cancellationReason, timezone`). NOT two/five Appointment
  variants.
- **G3 — multi-product event separation.** `appointment.created` is produced for
  BOTH products as DISTINCT contracts — the booking app's customer-initiated one
  (`source: customer`) and the ops console's agent one (`source: agent`, `agentId`).
  They must NOT be merged into a single artifact.
- **G4 — endpoints.** Operations exist for the booking app (`GET /api/providers`,
  `GET /api/providers/{id}/slots`, `POST /api/appointments`,
  `POST /api/appointments/{id}/cancel`, `POST /api/appointments/{id}/reschedule`)
  and the ops console (`GET /ops/appointments`, `POST /ops/appointments`,
  `POST /ops/appointments/{id}/no-show`, `POST /ops/appointments/{id}/refund`).
- **G5 — auth.** An AuthRequirement for the booking Bearer JWT and one for the
  ops Okta SSO; an AuthorizationRule for booking-app customer ownership ("act only
  on your own appointments") and one for the ops `ops-agent` role.
- **G6 — architecture decisions.** ArchitectureDecision artifacts for the data
  store (Postgres + outbox) and time zones (UTC / IANA) — i.e. the ADRs were
  tagged AND generated (the recall fix).
- **G7 — cancellation window reconciliation.** The current cancellation contract
  reflects **48h** (v2 supersedes README's 24h by recency/precedence) OR the 24h
  vs 48h conflict is surfaced as the S6 overlap for the user to resolve — never a
  silent, unflagged pick of 24h.
- **G8 — noise excluded.** No contracts for Twilio / MessageBird / external SMS
  endpoints, and nothing derived from the sprint task board.
