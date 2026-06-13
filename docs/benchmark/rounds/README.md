# Contract round-trip benchmark — version history

A round-trip experiment on the three spec docs in [`../`](../) (`decisions.md`,
`design.md`, `future-work.md` — a "cancellation reason requirement" feature):

```
original spec docs ──► spec scan + contracts generate ──► .tc contracts
                                                              │
                       (blind: contracts only, no docs) ◄─────┘
                                   │
                              reconstructed spec ──► compared back to the originals
```

The goal: find contract **kinds** that (a) capture the requirements in this style of
doc, and (b) are **derivable from code by the deterministic engine** — not prose dumped
into `unenforceable-obligation`. The driving metric became **structural / code-derivable
coverage**, with `unenforceable-obligation` not counting and driven toward **zero**.

Each round below contains the generated `.tc` **contracts/** and the **spec reconstructed
blind from them** (an isolated session that saw only the contracts). Compare a round's
reconstruction against [`../design.md`](../design.md) + [`../decisions.md`](../decisions.md)
to see what survived the round-trip.

## Progression

| Round | Kinds available (new in **bold**) | Contracts | `unenforceable-obligation` | Coverage of code-derivable reqs | Coverage of ALL reqs |
|---|---|---|---|---|---|
| **1 — initial** | enum, entity, forbidden-artifact, unenforceable-obligation | 11 | **6** | ~28–31% | ~91% *(inflated — counts obligation prose)* |
| **2 — behavior + decision** | + **validation-rule**, **fallback**, **architecture-decision** (persistence-strategy + consequences) | 6 | **0** | ~76% | ~43% |
| **3 — data access** | + **field-exposure** | 7 | **0** | **~81%** | **~46%** |

*(Coverage % are LLM-graded at thorough-spec-review granularity; the denominator varies a
few requirements per run, so read the trend, not the decimals.)*

## What each round shows

- **[round1-initial/](round1-initial/)** — the engine's starting kinds. The data model
  (enum + entity field + default) and 3 out-of-scope items captured structurally;
  **everything behavioral fell into `unenforceable-obligation` prose** (validation logic,
  defaults, the ADR, data-flow, UI). Two reconstructions are included to show the trap:
  - `spec-reconstructed-from-ALL-contracts.md` — reads ~91% complete, but only because the
    6 obligations store the requirements *verbatim as prose* (not enforceable, not
    code-derivable).
  - `spec-reconstructed-STRUCTURAL-ONLY.md` — the same blind reverse with obligations
    withheld: ~31%. This gap is what motivated "don't count obligations, drive them to 0."

- **[round2-validation-fallback-decision/](round2-validation-fallback-decision/)** — added
  three code-derivable kinds, **eliminating all obligations**. The host/attendee
  requiredness matrix → two `validation-rule`s; null/absent → default → `fallback`; ADR-001
  (column vs metadata-JSON) → `architecture-decision` carrying rationale + rejected
  alternative + consequences as structured fields.

- **[round3-field-exposure/](round3-field-exposure/)** — added `field-exposure` for the
  data-flow read-projection (`requiresCancellationReason` included in
  `getEventTypesFromDB`'s select). Final: **0 obligations, ~81% of the code-derivable
  subset**, all 7 artifacts derivable from code.

## Ceiling

~Half of these docs is **pure narrative** — problem statement, user stories, UI copy,
concrete file paths, future-work ideas — which has no code signal and correctly produces
**no contract** (forcing it into `unenforceable-obligation` is the cheat round 3 avoids).
So 95% of *all* requirements is unreachable for this doc type; ~81% of the *code-derivable
subset* is near the practical ceiling here. Growing the general kind catalog further needs
docs that exercise other code-derivable requirement classes (feature flags, observability,
rate limits, migrations, dependency requirements).

## Kinds added by this experiment

`validation-rule` (required-when), `fallback` (null/absent → default), `field-exposure`
(read-projection), and an `architecture-decision` extension (persistence-strategy category
+ `consequences`). Each is general (cross-feature/ORM/framework), has a cross-language
(JS+Python) deterministic code extractor, and is represented in the sample IL fixtures.
