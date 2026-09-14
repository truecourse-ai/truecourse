# Engine issues found on the expense-tracker generate (2026-09-12)

Repository: `mild-chaos-labs/expense-tracker` at `f363ebe6`. Generate run `e32dc19e-0c45-4bc5-98c5-a826cfab4053`, hosted, claude-code mode. 85 flows synthesized, 37 scenarios written, 48 flows unsettled.

## 1. The generator refuses `request-control`, which the runner can do

### What happened

41 of the 85 flows (61 cases) were dropped before matching. They never reached a worker and no session was spent on them. Every one of them tests the app against a CONTROLLED provider or a controlled own request:

- CurrencyBeacon answers a rate, a 401/403, a quota error, a timeout, a redirect, invalid data
- the app's own `GET /api/expenses` is delayed or fails (loading state, retry a failed save/delete)

Each such case declares `requires: ["browser" | "http", "request-control"]` and a condition of `request-failure` or `request-pending`. The generate report holds 61 coverage gaps of kind `blocked-on` with blocker `unsupported-capability`, reason `Unsupported observation: request-control on the web driver` (or `api`).

### Why

`packages/shared/src/guard/verification.ts`:

```ts
export const GUARD_OBSERVATION_CAPABILITIES = {
  cli: ['process', 'filesystem'], api: ['http', 'process'], web: ['browser', 'http'],
}
```

`request-control` is not in the web or api list. `verificationCapabilityGap` therefore reports every such case as unsupported, and `partitionFlowPrerequisites` (`packages/guard-generator/src/prerequisites.ts`) drops the case. A flow whose cases are all dropped is skipped silently in the matcher (`generate.ts`, the `if (!eligibleFlow.milestones.length) continue` before `matchFlow`).

But the runner implements request control in two forms:

- `setup.http` stubs (`packages/guard-runner/src/capabilities/http.ts`): a scenario starts a small HTTP server the app is pointed at through the external's base-URL env var (`recipe.api.externals.<service>.baseUrlEnv`). This is exactly what an unprovided CurrencyBeacon needs: the runner's own message says "stub it with setup.http".
- the always-on externals proxy (`packages/guard-runner/src/capabilities/external-proxy.ts`): in front of every PROVIDED external account, a scenario can script faults (status, delay, body) per call and assert call counts. It only exists when the account is provided.

Delaying the app's OWN requests (the `request-pending` cases on `/api/expenses`) is not implemented by either; that half of the capability is genuinely missing on the web driver.

### Proposed fix

1. Split the capability in the registry into what the runner actually has: provider control (stub when unprovided, proxy faults when provided) on `api` and `web`, and own-request control (delay/fail the app's own endpoints from the browser) which stays unsupported until a driver implements it.
2. Let the synthesis session declare which of the two a case needs, so the gate can tell them apart.
3. The worker prompt for a provider-control case must be told the two realizations and the recipe's `baseUrlEnv` for the service.

On this repository that is the difference between 37 authored scenarios and roughly 75.

### Also in this run, engine side

- Prerequisite names are not canonicalized at synthesis: one case said `CurrencyBeacon`, another `currencybeacon`; `resolveGuardPrerequisite` is exact-match; the pre-match gate validates `provided` prerequisites only, so the `absent` one reached a worker, which spent 13 attempts on `unknown prerequisite: CurrencyBeacon` and filed the fault as an interface defect. Fix: validate and rewrite prerequisite names against the catalog (name + aliases, normalized) at the synthesis session's outcome boundary; gate every mode before matching; keep the runner strict.
- Dropped flows are invisible on the conversation: the matcher records no fact for a flow whose cases were all partitioned out, and the workers counter counts worker outcomes only, so "85 flow×surface" lists 42 and "blocked 0" stands beside 43 dropped flows. Fix: one fact per dropped flow with its gap reason; count them.
