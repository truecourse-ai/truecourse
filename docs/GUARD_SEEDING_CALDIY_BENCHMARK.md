# Guard seed-sidecar cal.diy benchmark

This is an evidence record, not a golden-count test. The motivating cal.diy
snapshot reported 44 `blocked-on` rows, 27 of which named `missing-data`. That
historical result is the ticket's fixed benchmark population; the implementation
does not assume that all 27 can or should become scenarios.

## Evidence available on 2026-08-04

The local cal.diy checkout's latest completed Guard generation result was read from
`.truecourse/guard/result.json` (`generatedAt: 2026-08-04T17:42:26.232Z`). It was a
successful run with 58 written scenarios, 33 `blocked-on` gaps, and 23 rows whose
reason still named `missing-data`. This newer 23-row snapshot is not presented as a
sidecar rollout result: it predates applying this branch to cal.diy and therefore
cannot establish a before/after conversion rate.

The 23 evidence-backed residual demands break down as follows:

| Demand | Flow evidence in the current result |
| --- | --- |
| Team, organization, membership, or managed-event state | `create-and-book-a-managed-event-type`, `invite-view-and-remove-a-team-member`, `delete-a-team` |
| Pending, dynamic, seated, recurring, or round-robin booking state | `confirm-a-booking`, `cancel-a-booking-with-reason-requirement-enforced`, `view-a-booking-by-seat`, `cancel-a-booking-2`, `reassign-a-booking-to-a-new-host`, `reschedule-a-booking-2`, `confirm-a-booking-2` |
| OAuth client, managed-user token, or client-scoped webhook state | `scope-a-webhook-to-a-platform-oauth-client`, `view-oauth2-client-and-exchange-authorization-code-for-9bde4ab0`, `create-manage-and-refresh-tokens-for-a-managed-user`, `create-list-update-and-delete-oauth-client-webhooks` |
| Calendar connection, credential, or provider-owned event state | `identify-cal-diy-created-events-in-google-calendar`, `retrieve-a-calendar-event-s-details`, `check-calendar-free-busy-times`, `create-update-and-delete-an-event-on-a-calendar-connection`, `create-update-and-delete-a-calendar-event`, `view-and-list-calendar-events`, `list-calendar-connections-and-view-connection-events` |
| Out-of-band verification code | `request-verify-and-list-verified-phone-numbers`, `request-verify-and-list-verified-email-addresses` |

The hermetic acceptance test in
`tests/guard-runner/seeded-acceptance.test.ts` exercises the seedable shapes from
that population: lifecycle state, organization/team/member aggregation, recurring
and past bookings, a generated verification credential, mutation repair,
convergence, and namespace non-interference. Three sidecar executions against one
reusable fixture store completed in 669 ms. That is a runner acceptance measurement,
not cal.diy production-database telemetry.

## Remaining rollout evidence gap

This repository does not contain a cal.diy checkout or its datastore, and this
branch did not mutate the separate local benchmark checkout. Consequently it makes
no claim that any of the historical 27 or current 23 rows converted to committed
cal.diy YAML/sidecar pairs. A follow-up benchmark must run the published feature
against a clean cal.diy worktree, review and authorize the generated executable
sidecars, then record each selected row as either a birth-verified pair or a precise
capability gap. Seeded concurrency remains deferred until that run supplies real
runtime and ownership telemetry.
