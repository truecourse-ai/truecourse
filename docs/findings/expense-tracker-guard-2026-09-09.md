# Expense Tracker guard generation, September 9, 2026

The improvements are producing stronger tests, especially Add, Edit, and Delete. Reviewer citation repair also worked in a live session. The result still exposes engine defects: a supposedly empty preparation inserts an expense, expected-failure review certifies that setup mistake as application drift, and retirement correction can end after correcting the explanation without attempting another repair.

This investigation read local PostgreSQL with `default_transaction_read_only=on`. It inspected the generation report, setup/scenario bundles, execution snapshot, and generation activity journal. No database rows, generated artifacts, or application code were changed. No pipeline or dev server was run.

Repository: `spiderhands/expense-tracker`, commit `58899f746bc470cfafb802d1cb27b35893631ad6`.

Generation: `39d49154-ed97-4840-90d3-12ea13ecfff4`, September 9, 14:55:06–15:17:47 UTC. Execution: `2026-09-09T15-17-55Z_e0f41b70`.

| Measure | Previous recorded baseline | Latest |
| --- | --- | --- |
| Complete generated flows | 6/17 | 12/26 |
| Saved scenarios | 10 | 14 |
| Execution results | 9 pass, 1 fail | 12 pass, 2 fail |
| Reviewed cases in current manifest | Not recomputed | 61/118 |

The previous figures come from Plans 002–005 and their recorded September 9 investigation. The database currently retains one result for this repository/commit, so the old run was not independently reconstructed. Extraction changed the flow boundaries and denominator; the counts do not establish a like-for-like percentage improvement.

Of the 61 reviewed cases, 56 belong to passing scenarios. Five belong to the two false empty-state failures below. These counts cover the 26 manifest flows, not all specification material: implementation/library claims and three recipe-entry gaps also remain in the report. All 14 saved YAML scenarios passed schema parsing, current review-policy checks, fingerprint recomputation, and case-evidence reference validation. That establishes valid bindings, not infallible reviewer judgment.

| Flow | Reviewed cases | Latest execution |
| --- | --- | --- |
| Add an expense | 8/8 | Pass |
| Edit an expense | 4/4 | Pass |
| Delete an expense | 4/4 | Pass |
| Reject invalid expense writes | 11/11 | Pass |
| Keep rejected writes unchanged and allow direct deletion | 3/3 | Pass |
| Query expense collections | 8/8 | Pass |
| Receive API protocol responses | 3/3 | Pass |
| Return from a missing expense | 2/2 | Pass |
| See no matching expenses | 2/2 | Pass |
| Reject invalid filters without exposing list mutations | 3/3 | Pass |
| View an empty ledger | 3/3 | Fail because preparation inserts data |
| Start with an unseeded empty ledger | 2/2 | Fail because preparation inserts data |
| Create, read, replace, and delete expenses | 8/20 | Two passing partial scenarios |
| Filter and page through matching expenses | 0/18 | No accepted scenario |
| Review expenses and open details | 0/9 | Matcher timeout |
| Display expense dates without timezone shifts | 0/1 | Rejected single-timezone proof |
| Ten flows requiring unsupported observations | 0/17 | Explicit capability gaps |

The ten capability-blocked flows require request control, concurrency, filesystem, or datastore observations. These gaps should remain visible and are distinct from authoring failures.

**The browser checks are materially better.** Add now proves dialog fields, browser-local date and category defaults, cancellation, post-save closure/announcement, exact refreshed totals, return to page one, and preserved filters. Its final scenario first deletes the preparation fixture and verifies an empty ledger, then creates six $1 expenses and one $10 expense to establish exact totals. Edit creates its own record, verifies prefilled values, cancellation, saved values, and persistence after reload. Delete creates its own target and checks confirmation, cancellation, removal, and the total change. These checks survive the subsequent deterministic run.

**Reviewer repairs worked.** All 29 fidelity sessions completed, yielding 14 faithful and 15 flagged outcomes. In the API protocol review, activity cursor 224 reports invalid citations for `no-store`: steps 5 and 6 were tagged for other cases. The reviewer corrected its evidence to eligible steps 1, 2, 3, 4, and 7 at cursor 236. No author rewrite was needed for that metadata defect. Other semantic rejections led to stronger accepted Add, API query, and invalid-filter tests.

**The highest-priority defect is the empty preparation.** Setup `ec808676-d3bb-4f61-a282-7c207e676dd9` saved `sqlite-empty` with `baseline: empty`, but its seed explicitly calls `createExpense` for `TrueCourse guard fixture expense`, amount `$23.47`. Its verifier expects one row and 2,347 cents for that empty baseline. It does execute a real peer-isolation check, but proves the wrong starting state. Both failing tests subsequently observe exactly that fixture. Expense Tracker's `lib/store.ts` at the same commit creates schema on first access and does not seed the expense.

The setup prompt requires an empty baseline, but the generated verifier and runner accept an `empty` marker after the verifier has checked one row. See `packages/core/src/services/guard-setup/preparation-session.ts:276` and `packages/guard-runner/src/preparation.ts:211`. The worker briefing exposes only fixture ID/description, hiding the known amount. This also obstructed API aggregate authoring. Fix the preparation contract so empty means zero business records, and expose independently known baseline values for controlled populated profiles.

**Expected-failure review misattributes our fixture to application drift.** The two empty-state tests were accepted as faithful at cursors 311 and 332. Their evidence reasons assume the declared empty preparation is true. The startup test's committed `expectedRed` calls the observed fixture `code-drift`. These failures are reproducible, but they do not establish defects in Expense Tracker. A failing test needs verified starting-state evidence before it can certify application drift.

**Repair-before-retirement still allows early exit.** Filtering matched 17 of 18 cases, preserving the independently executable cases despite the out-of-range-page catalog gap. Its drafts then had real authoring defects: wrong visible text, a wrong second-page expectation, weak wildcard controls, insufficient controls for AND filtering, and missing global-total checks after paging. The latest semantic rejection is cursor 505. The engine requests correction at 512; the next outcome at 519 only supplies corrected remaining dispositions and retires. No new scenario submission intervenes. The session used eight turns and has no budget-exhaustion failure, despite its final prose citing available budget.

`packages/guard-generator/src/generate.ts:2694` grants one correction for an unchanged issue set and then permits termination. This enforces accurate blocker reporting, but does not require an actual repair attempt. `rememberRejection` at line 2673 also applies one aggregate rejection to every selected case. Consequently, one filter defect becomes the explanation for independently different search and pagination cases. The same problem leaves API validation cases carrying a date-rule rejection even after a separate date-rule scenario was accepted.

**Malformed outcomes bypass correction.** The API lifecycle worker preserved two accepted scenarios covering 8/20 cases, then returned `kind: blocked` with `additionalScenarios` at cursor 607. The schema forbids that combination and the session fails at cursor 608. `packages/agent-loop/src/agent-loop.ts:504` breaks out of outcome correction when schema parsing fails, then finalizes as malformed. Bounded schema correction should happen before semantic outcome validation; already accepted artifacts should continue to survive it.

**A timeout and a capability mismatch remain.** Matching `review-expenses-and-open-details` timed out after 300 seconds, leaving all nine cases ungenerated. Timezone invariance was routed to a browser worker, then rejected because the scenario rendered only one timezone. The current executor cannot author a timezone switch, so that requirement should be classified as an explicit capability gap before authoring.

Generation took about 22 minutes 41 seconds. Recorded session costs total $6.16, plus $0.25 of matcher usage, approximately $6.42. This excludes setup/interface authoring. The API lifecycle worker alone used 581,339 recorded tokens, 15 turns, and nine fidelity sessions to retain 8/20 cases. Better preparation contracts, precise rejection attribution, and actual repair attempts are the next priorities; the trace does not justify solving this by raising budgets.

Implementation follow-up: the user subsequently authorized fixes. Runner-executed baseline checks, legacy profile migration, required executable repair submissions, and bounded worker outcome-schema correction are implemented. Validation passed 2,453 tests across 176 files, with one existing skip, plus core/dependency builds. Aggregate rejection attribution, matcher timeout recovery and early timezone capability classification remain open. See [the current project status](../../PLAN.md). The observations above describe the original stored run; no historical artifacts or live database rows were rewritten. Refresh preparations and regenerate to measure the updated engine.
