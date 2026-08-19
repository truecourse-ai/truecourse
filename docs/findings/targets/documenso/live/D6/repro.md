# D6 live re-verification

**The rate limit advertised in the `x-ratelimit-limit` header.**

- Date: 2026-08-19
- Build: `documenso/documenso` `main` @ `75330166cc00b29c14399bc2e391e4b4d8080c00` = tag **v2.17.0** (2026-08-19). The finding was recorded against v2.16.0.
- Instance: port 3347, database `tc_reverify_documenso`. Auth `Authorization: <owner api token>`, redacted.

## Verdict

**fixed.** v2.17.0 advertises `x-ratelimit-limit: 1000`, which is the number three doc pages publish. PR #3081 (merged 52 minutes after v2.16.0 was tagged) is now in a release.

## Steps

**Without `DANGEROUS_BYPASS_RATE_LIMITS`** (the brief's requirement; the original guard run DID set it and still saw 100)

1. `GET /api/v2/envelope` -> **200**, response headers:
   ```
   x-ratelimit-limit: 1000
   x-ratelimit-remaining: 999
   x-ratelimit-reset: 1787166840
   ```
2. `GET /api/v2/envelope` again -> **200**, `x-ratelimit-limit: 1000`, `x-ratelimit-remaining: 998`, same `x-ratelimit-reset`. The counter decrements, so the limiter is live and not stubbed.

**With `DANGEROUS_BYPASS_RATE_LIMITS=true`**, the server restarted with the flag set exactly as the original run had it:

3. `GET /api/v2/envelope` -> **200**, `x-ratelimit-limit: 1000`, `x-ratelimit-remaining: 999`, `x-ratelimit-reset: 1787167440`.

The advertised limit is 1000 both ways, so the flag is not what produced the old 100.

Raw captures: `step-1.request.json` ... `step-3.response.json`.

## Comparison with the original transcript

The original run (v2.16.0) failed at its step 2 with `expected: header x-ratelimit-limit equals "1000" / actual: header x-ratelimit-limit was "100"`. Its step 1, which only asserts the three headers exist, passed. On v2.17.0 both steps would pass: the headers are present, well-formed and now carry 1000.

## What this changes for the finding

- Both halves of D6 are closed upstream. The product half shipped in v2.17.0 (#3081); the contradictory "No rate limit headers are currently provided" callout in the docs was removed by #3133, merged the same day.
- The review's `fixedAfter` wording "fixed on main, in no tag" is out of date. The correct statement is "fixed and released in v2.17.0".
- Nothing here should be filed. The one durable observation is the process one the research note makes: docs.documenso.com is built from `main`, so a doc change describing new behaviour is published before the release that ships it, and a self-hoster on a tag cannot tell from the docs which build they describe. That is a note for a write-up, not an issue.
