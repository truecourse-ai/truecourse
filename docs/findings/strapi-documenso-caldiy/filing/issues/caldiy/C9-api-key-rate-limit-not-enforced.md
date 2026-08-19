---
finding: C9
target: calcom/cal.diy
route: security disclosure
title: The documented and code-configured 120 requests per minute per API key is not enforced on API v2
labels: none (private advisory)
status: draft
reverified: pending (source re-checked 2026-08-19 at calcom/cal.diy main 176037d0afbe572f870a3c702985e7cd83fe6c0c: both culprit files byte-identical to the tested tree) [MEDIUM CONFIDENCE: needs the live re-run to confirm before filing]
---

# The documented and code-configured 120 requests per minute per API key is not enforced on API v2

Private report via the GitHub private advisory form on calcom/cal.diy (https://github.com/calcom/cal.diy/security/advisories/new), with a copy to security@cal.com per SECURITY.md. This is a source-level report plus a local reproduction on self-hosted Cal.diy built from the public repository. No traffic was sent to any hosted infrastructure, and this makes no claim about the hosted Cal.com service.

## Summary

The v2 API publishes a rate limit of 120 requests per minute per API key, and `CustomThrottlerGuard` is configured with exactly that number. On a build from source, 121 `GET /v2/bookings` requests made with one API key inside a single minute were all answered 200. No 429 was returned, and no `ThrottlerException` appears anywhere in the run. The documented access control is absent in practice, so an operator who reads the reference believes every API key and every anonymous caller is capped when nothing is capping them.

This is reported as an authorization and documented-contract failure first: a control the product publishes, configures and tests is not applied, so a self-hoster's threat model is wrong. The availability consequence is secondary and is stated last.

Confidence note, carried deliberately: the evidence proves the limit was not enforced. It does not prove which link failed open. Two candidates remain and this report does not pick one. See "Cause".

## Affected

- Component: `apps/api/v2` (`@calcom/api-v2`), `apps/api/v2/src/lib/throttler-guard.ts`, wired as a global `APP_GUARD` in `apps/api/v2/src/app.module.ts:80-83`.
- Applies to every v2 endpoint, authenticated and anonymous alike. `GET /v2/bookings` was the endpoint exercised.
- Present in the tested tree at `038381aeca6261635357957d66b8ba85cdb29737` (2026-07-31) and byte-identical on `main` at `176037d0afbe572f870a3c702985e7cd83fe6c0c` (2026-08-08).

## Docs

https://cal.com/docs/api-reference/v2/introduction , section "Rate limits":

> There are three authentication methods for the API, and each of them has the following rate limits:
>
> 1. API Key - 120 requests per minute. This can be increased to a reasonable amount, such as 200 requests per minute. If you require a higher rate limit, such as 800 requests per minute, it is possible, but it may involve extra charges. To request this, please contact support.
>
> If no authentication method is provided, the default rate limit is 120 requests per minute.

The number is not stale documentation. `apps/api/v2/src/lib/throttler-guard.ts:36` sets `defaultLimitApiKey = getEnv('RATE_LIMIT_DEFAULT_LIMIT_API_KEY', 120)` and line 39 sets `defaultLimit = getEnv('RATE_LIMIT_DEFAULT_LIMIT', 120)`, matching both documented figures, and issue #24963 (closed 2025-11-11) is the request that produced this doc section from those code defaults.

## Reproduce

Build tested: Cal.diy from source at commit `038381aeca6261635357957d66b8ba85cdb29737`, API v2 built with `yarn workspace @calcom/api-v2 build` and served from `apps/api/v2/dist/apps/api/v2/src/main.js`, against Postgres and `redis:7-alpine` in Docker. The repository has no `.env` file in the checkout and no `RATE_LIMIT_*` variable was set, so the 120 defaults applied.

1. Send 120 identical requests with one API key inside one minute:

```
GET /v2/bookings
cal-api-version: 2024-08-13
Authorization: <api key>
```

All 120 answer 200.

2. Send the 121st, same key, same minute, same request.

**Observed**: 200, with the normal bookings payload (`{"status":"success","data":[{"id":3,"uid":"refbk-past-older",...`).

**Expected**: 429, per the documented 120 per minute and per `getDefaultRateLimit`'s `{limit: 120, ttl: 60000, blockDuration: 60000}`.

The API server's own HTTP log records exactly 121 `GET /v2/bookings` requests, all with the same credential and all answered 200, between 10:49:06.446 and 10:49:14.810, so the whole burst landed inside 8.4 seconds of one minute. Grepping the entire run evidence tree (100+ scenario directories, several thousand requests) for the guard's own message "Too many requests" returns nothing: not one 429 was issued anywhere in the run.

RE-VERIFY: live re-run pending (the source was re-checked on 2026-08-19 and is unchanged; a full live re-run against a fresh Cal.diy build could not complete on the local machine for lack of disk, and the build clone is preserved for resume). This finding stands on the original guard run evidence plus the source re-check.

## Cause

`CustomThrottlerGuard` is the only thing that enforces this limit. Read end to end, the path should have refused the 121st call:

- `getTracker` (`throttler-guard.ts:213-236`) turns `Bearer cal_<secret>` into `api_key_<sha256(secret)>`.
- `handleApiKeyRequest` (`:80-96`) looks the key up, finds no `RateLimit` rows (the seed inserts only into `ApiKey`, and no migration inserts `RateLimit` rows), and falls back to `getDefaultRateLimit` (`:112-119`), which is 120 per 60000 ms.
- `incrementRateLimit` (`:179-211`) delegates the block decision to `this.storageService.increment` (`:184-190`), whose `isBlocked` is true once `totalHits` exceeds the limit, and sets the `X-RateLimit-*` headers at `:193-198`.

Permalink at the tested commit: https://github.com/calcom/cal.diy/blob/038381aeca6261635357957d66b8ba85cdb29737/apps/api/v2/src/lib/throttler-guard.ts#L30-L96 (and `#L179-L211`). Same lines on `main` today: https://github.com/calcom/cal.diy/blob/176037d0afbe572f870a3c702985e7cd83fe6c0c/apps/api/v2/src/lib/throttler-guard.ts#L30-L96

Every precondition held in this run and the call still returned 200, so one link failed open. Two candidates remain and the captured evidence cannot separate them:

- (a) the guard never ran for the route, or
- (b) `ThrottlerStorageRedisService.increment` never reported `isBlocked` (the pinned pair is `@nestjs/throttler` 6.2.1 with `@nest-lab/throttler-storage-redis` 1.0.0, `apps/api/v2/package.json:50,60`).

One burst with the response headers captured settles it. If `X-RateLimit-Limit-Default` and `X-RateLimit-Remaining-Default` are absent, the guard did not run. If they are present and `Remaining` counts down to 0 without a 429, the storage layer is the culprit. This is offered rather than guessed at.

Environment was ruled out as far as the evidence allows: Redis was up and reached ("IoRedis connected!" is logged at 10:49:05.845, before the first request), no `.env` file exists so no `RATE_LIMIT_*` override was in play, no migration seeds `RateLimit` rows, there is no `@SkipThrottle` anywhere in `apps/api/v2/src`, only one `APP_GUARD` is registered, and the request authenticated successfully as `userId 1`, which proves the same `cal_` prefix logic the tracker uses classified the credential as an API key rather than an access token (so the 500 per minute access-token branch is not the explanation).

Worth including because it is what makes this invisible to an operator: every `this.logger.verbose` call in `throttler-guard.ts` is commented out (`:100-102`, `:146-148`, `:170-171`, `:200-208`), so a running server emits zero throttler diagnostics. Nothing in the logs tells a self-hoster that the limit is not being applied.

The code is old and was working when written: `apps/api/v2/src/app.e2e-spec.ts:134-175` asserts 429 at limit+1 against real Redis with the same guard, and that test shipped with the guard in PR #16882 (`4b6a389212f95f2be73fc3e58d382365865f51ce`, 2024-10-01). The newer sides of the interaction, if it is one, are the tracker rewrite `d1bd05a791` (PR #22767, 2025-07-30, which hashed the tracker) and the pinned throttler dependency pair. Please do not read the blame as "PR #16882 is the bug".

## Related

- Issue #29367 "fix(security): rate limiter fails open + tRPC rate limiting disabled" (open, labelled Stale, last touched 2026-07-28). Same failure mode in a different limiter: `packages/lib/rateLimit.ts:36-41` returns success when `UNKEY_ROOT_KEY` is missing, and the tRPC middleware is commented out. **This report is not that issue.** `/v2/bookings` is served by `apps/api/v2/src/lib/throttler-guard.ts`, which #29367 does not mention.
- PR #29381 and PR #29395, both community attempts at #29367, both closed unmerged. Neither touches `throttler-guard.ts`, so neither would have changed this outcome. #29381's body does claim "Self-hosted instances had zero rate limiting (fail-open)", which is the same headline a maintainer would draw from the evidence here, but on the other limiter.
- Issue #12306 (open since 2023-11-09): documented rate limit headers do not appear in any response, on the v1-era API. Same symptom family, different code path.
- Issue #24963 (closed) and PR #16882 (merged): the origin of the documented number and of the guard.
- No search found a report of this specific failure. `--owner calcom "rate limit"` updated since 2026-08-01 returns 5 unrelated hits; `gh search prs --owner calcom "throttler"` returns 30 hits whose newest merged item is #22767 from 2025-07-28.

Separately, and not part of this security report: the bound doc section is internally incoherent. It opens "There are three authentication methods for the API, and each of them has the following rate limits:" and then lists exactly one, because the OAuth-client and managed-user entries were moved under the "Deprecated & Maintenance for existing users only" heading without their numbers. A reader cannot learn the OAuth or access-token limit from that page. That is a documentation item, filed separately, and is mentioned here only so it is not confused with the enforcement failure above.

Found by TrueCourse running the published Cal.com v2 API reference against a live Cal.diy instance built from source; the full transcript (requests, responses, server log) is available on request.
