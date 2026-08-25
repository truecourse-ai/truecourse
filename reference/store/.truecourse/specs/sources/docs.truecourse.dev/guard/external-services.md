> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# External services

> Hermetic by default: app-owned fakes, scripted stubs, or real sandbox accounts behind a fault-scriptable proxy.

Guard scenarios are **hermetic**: nothing assumes network access to a third party. A run that depends on Stripe or SendGrid being reachable isn't a test, it's a weather report. When the app under test calls an external service, guard offers an escalation ladder; claims that genuinely can't be driven without a third party settle as visible `blocked-on` coverage gaps rather than fabricating a pass.

## How services are detected

`guard generate` detects the third parties the repo depends on from the analysis pass it already runs: both the **SDKs it imports** (stripe, sendgrid, s3, …) and the services it reaches with a plain HTTP request and no SDK at all, read off the `https://…` literals in the source and grouped per vendor. Localhost, `example.com`, private suffixes, and schema-namespace URLs are never counted. Each service carries the env var(s) the app reads its base URL from, which is exactly what a stub or an account has to override. (URL-literal detection is JS/TS only today; Python and C# detect SDK imports only.)

Hosts the repo **owns** (its production origins written as env-var fallbacks, links to its own site) are excluded via `ownHosts` in the [recipe](/guard/recipe), and derived automatically where the recipe pins a variable whose code fallback is a URL literal.

Blocked flows are **named**: a gap reads `blocked on stripe: <claim>`, `guard status` breaks the blocked count down per service, and the full detected list rides `guard/result.json` and the dashboard's generate overview. When what's missing is pre-existing data instead, the flow settles on `missing-data` plus the entity it needed, which the dashboard reads as "needs seed data".

## 1. Reach for your app's own fakes first

Most codebases already have test doubles behind an env flag. Turn them on through the recipe; the fake stays under the app team's control:

```json theme={null}
{
  "api": {
    "serve": ["node", "dist/server.js"],
    "env": { "PAYMENTS_FAKE": "1", "EMAIL_TRANSPORT": "memory" }
  }
}
```

## 2. Scripted stubs: setup.http

Some claims are *about* the third party: "an upstream 5xx becomes a 502 that leaks nothing", "we never call the payment API in dry-run mode". A scenario can declare a **stub**: a loopback HTTP server the runner boots before the app starts, scripted with exactly the responses the flow needs. It works whenever the app reads the dependency's base URL from an env var; the stub's origin is substituted into `setup.env` as `${HTTP_STUB:<name>}`:

```yaml theme={null}
setup:
  env:
    FORECAST_BASE_URL: ${HTTP_STUB:forecast}   # the app's own base-URL override
  http:
    forecast:
      routes:
        - method: GET
          path: /v1/forecast                    # exact pathname (or one trailing `/*`)
          status: 200
          json: { current: { weather_code: 4 } }
          expect:                                # …and what the app MUST have sent
            query: { timeformat: unixtime }
            headers: { accept: application/json }
          calls: 1                               # exactly once, no retries
steps:
  - request: { method: GET, path: /v1/weather?lat=52.52&lon=13.41 }
    expect: { status: 200, json: { current.condition: { equals: unknown } } }
```

**Both halves are asserted**: responses are scripted, and `expect` checks the request the app sent, so "the app called the third party wrongly" is a red test, not an invisible pass. `calls` pins the exact number of hits (`calls: 0` asserts the app never touches that route). A call nothing scripted fails the scenario, naming the method and path received. Stubs are available to both drivers.

## 3. Real accounts: api.externals

Sometimes the honest answer is a sandbox (or throwaway real) account. Declare it and guard points the app at it before every scenario, and tells the authoring model the service is **live** instead of a blocker. The declaration is committed in `recipe.json`; the **secrets are not**:

```json theme={null}
{
  "api": {
    "serve": ["node", "dist/server.js"],
    "externals": {
      "open-meteo": {
        "baseUrlEnv": "GEOCODING_BASE_URL",
        "baseUrl": "https://sandbox.open-meteo.test",
        "endpoints": { "FORECAST_BASE_URL": "https://sandbox-forecast.open-meteo.test" },
        "mode": "sandbox",
        "env": { "GEOCODING_API_KEY": {} },
        "description": "shared team sandbox org"
      }
    }
  }
}
```

`GEOCODING_API_KEY: {}` declares the app needs the variable without saying what it is; the value lives in the sibling **gitignored** `.truecourse/scenarios/externals.local.json`, merged over the declaration per field at run time. Per variable, the alternatives are `{"valueFromEnv": "VAR"}` (read from the host environment at run start) and `{"value": "…"}` for values that genuinely aren't secret. **Never put a real key in `value`**; `recipe.json` is committed.

A service is **provided** when a base URL is known and every declared variable resolves; then the runner injects them into the server's environment and authoring writes flows against it. Declared with nothing supplied is **unprovided**; flows stay `blocked-on`. Anything in between is **incomplete**, and `guard run` stops with `missing-external-env` rather than booting the app against a world nobody described.

[`guard setup`](/guard/setup) writes the declaration **skeleton for every detected service up front**, including ones you have no account for. The declaration is what enters the recipe fingerprint, values are excluded, so handing guard a real key later touches only the local overlay and re-authors nothing. Fill it in interactively via `guard setup`, or through the dashboard's **External APIs** tab (declaration to `recipe.json`, secret to the overlay); `truecourse guard externals` is the read-only view.

## Scripted faults on a real account: setup.externals

A provided account is never reached directly: every base-URL variable of a provided service points at a runner-managed loopback **proxy** whose upstream is the account. Unscripted traffic forwards verbatim, and any scenario can make the vendor misbehave:

```yaml theme={null}
setup:
  externals:
    open-meteo:
      faults:
        - match: { method: GET, path: /v1/forecast }
          respond: { status: 503, json: { error: "upstream" } }
          once: true                                 # …then step aside
        - delayMs: 3000                              # slower than the app's own timeout
      calls: 1
steps:
  - request: { method: GET, path: /v1/weather?lat=52.52&lon=13.41 }
    expect: { status: 502, json: { error.code: { equals: upstream_unavailable } } }
```

Four primitives: `respond` (a forced answer instead of the real one), `delayMs` (wait, then respond or forward), `refuse: true` (the connection dies unanswered), `once: true` (the rule fires once and is consumed). `calls` asserts the exact number of calls across all of the service's endpoints: `1` proves the app doesn't retry, `0` proves this mode never touches the vendor.

**Precedence:** a scenario's `setup.env` (including a `${HTTP_STUB:…}` origin) beats the external account, which beats `api.env`. **Secrets hygiene:** resolved values are masked out of every transcript as `«external:<service>.<VAR>»`; rotating a key in the local overlay never changes the recipe fingerprint, so a rotation never re-runs the LLM.

## Next steps

<CardGroup cols={2}>
  <Card title="Guard generate" icon="wand-magic-sparkles" href="/guard/generate">
    Author scenarios; provided services author as live, missing ones settle as named gaps.
  </Card>

  <Card title="Guard run" icon="play" href="/guard/run">
    Run the committed scenarios deterministically.
  </Card>
</CardGroup>
