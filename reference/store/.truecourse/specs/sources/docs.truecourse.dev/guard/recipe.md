> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# The recipe

> scenarios/recipe.json tells guard how to build your repo and what the scenarios drive: a CLI binary, an HTTP service, or both.

The recipe tells guard how to build your repo and what the scenarios exercise:

```json theme={null}
{
  "install": "pnpm install --frozen-lockfile",
  "build": "pnpm turbo build --filter=...{./tools/cli}",
  "entry": ["node", "tools/cli/dist/index.js"],
  "env": { "MY_FLAG": "1" }
}
```

| Field      | Required            | What it does                                                                                                                                                                                                                                                                                                      |
| ---------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`  | optional            | One shell command, run in the repo root before every build, to fetch dependencies (e.g. `npm ci`). Omit it when the build needs no dependency fetch.                                                                                                                                                              |
| `build`    | yes                 | One shell command, run in the repo root before scenarios execute.                                                                                                                                                                                                                                                 |
| `entry`    | for `cli` scenarios | The entrypoint argv; each scenario's command is appended to it. Repo-relative. Optional when the repo only has `api` scenarios.                                                                                                                                                                                   |
| `env`      | optional            | Extra environment variables for every scenario run.                                                                                                                                                                                                                                                               |
| `ownHosts` | optional            | Hosts the repo **owns**, i.e. its own deployed origins (e.g. `["cal.com"]`; matching covers subdomains). URL literals pointing at them are the app talking about itself, so [external-service detection](/guard/external-services) skips them. Also derived automatically from env-var fallbacks the recipe pins. |
| `api`      | optional            | The api driver's preparation, for repos whose specs describe an HTTP service; below.                                                                                                                                                                                                                              |

## The file is yours

The recipe is derived and **proved** once, by [`truecourse guard setup`](/guard/setup), and never touched again. An existing `recipe.json` always wins, and it's committed so the whole team runs the same preparation. Edit it when the discovered command isn't what you want, e.g. harden a cache-prone build with `turbo build --force`, at the cost of slower runs.

<Warning>
  Recipe edits change the **recipe fingerprint**: sections generated against the old recipe are re-authored on the next generate, and the dashboard flags runs made under an older recipe. That's also why derivation lives only in `guard setup` (`--refresh` to re-derive), never as a byproduct of the expensive generate stage.
</Warning>

`truecourse guard recipe` is the recipe's read command: it prints the recipe as loaded (inline credential values masked), whether it parses, and whether its discovery inputs have moved since the last run.

## The api driver: `api`

For repos whose specs describe an HTTP service:

```json theme={null}
{
  "build": "pnpm build",
  "api": {
    "serve": ["node", "dist/server.js"],
    "healthPath": "/health",
    "services": { "up": "docker compose up -d db", "down": "docker compose down" }
  }
}
```

* `serve`: the argv that starts the server. The runner allocates a free port, injects it as `PORT`, and boots **one fresh server per scenario** in that scenario's sandbox cwd, so state files are isolated per scenario. Servers that don't read `PORT` take the literal `${PORT}` anywhere in the argv or an `api.env` value (e.g. `["uvicorn", "app.main:app", "--port", "${PORT}"]`); the recipe keeps the template, so port allocation never changes the fingerprint.
* `cwd` *(default `"sandbox"`)*: where the server process runs. Use `"repo"` for a package-manager-mediated serve argv (`yarn workspace X start`, `pnpm --filter X start`): from a temp cwd the workspace root is invisible and the boot dies before it starts.
* `healthPath` *(default `/`)*: polled until it answers 2xx (budget `readyTimeoutMs`, default 30s).
* `env`: server-only variables.
* `services`: one-shot `up`/`down` shell commands (run once per run, in the repo root) for datastores the server needs. Guard runs your commands; it does no container orchestration itself.
* `seed`: the data + auth seed; see [Seeding](/guard/seeding).
* `externals`: real third-party accounts; see [External services](/guard/external-services).

Api scenarios then drive the booted server with `request` steps (method/path/headers/body), assert on `status`, `headers`, `body`, and JSON paths, and chain calls by `capture`-ing values from responses (JSON body via `capture`, response headers via `captureHeaders`; redirects are never followed, so a 3xx's `Location` is observable) into `${var}` placeholders.

**Cookies are automatic.** Every scenario gets its own cookie jar for the life of its server: whatever a response sets via `Set-Cookie` is replayed on later requests, honoring `Path`, `Max-Age`, and `Expires`, so a session-cookie login is just a first step. The jar is never shared between scenarios.

**The server process is drivable too.** Three optional step kinds cover claims about the process itself: `boot` ((re)starts the server; `expect: { ready: true }` by default, or `expect: { exitCode, stderrContains }` for the invalid-configuration claim), `signal` (send `SIGTERM`/`SIGINT`, optionally asserting the exit code), and `logs` (assert on what the server wrote, per line, substring or regex, optionally scoped to `sinceLastStep`). A restart gets a fresh port in the same sandbox, so "state survives a restart" is a five-line scenario.

### Multiple services: `api.servers`

A workspace that ships a web app *and* a separate API service replaces `api.serve` with a named `api.servers` map plus `api.defaultServer` (the two shapes are mutually exclusive; `cwd`/`healthPath`/`readyTimeoutMs` move into each server entry, and `api.env` stays as the shared layer). Each entry names `app`, the repo-relative directory of the workspace package it serves: that's what lets guard say "this documented path is served by `apps/api/v2`" instead of asking the wrong service.

A scenario names its service with `server: api-v2` (absent ⇒ `defaultServer`), but you rarely write it yourself: `guard generate` reads the workspace tree (Next.js and NestJS route files, no build and no LLM) and stamps each scenario with the server that owns its path. Guard boots **only** the servers the run's scenarios actually bind, and preflights each once; a service that won't start is one loud error, not N identical failures. A documented path belonging to an app no server is declared for is reported as `blocked on missing-server` instead of authored into a false failure.

### Credentials: `api.credentials`

`credentials` names request-header secrets the runner injects where a scenario writes `{{cred:<name>}}`. Each carries a `header` plus a `value`, `valueFromEnv`, or `fromRequest` source, never committed into a scenario. An optional `satisfies` names the OpenAPI security scheme the credential fulfills (a `satisfies` naming a scheme no OpenAPI doc declares stops `guard generate` with the known scheme names; it would silently un-map the scheme otherwise). An optional `servers` list scopes a credential to the service(s) it authenticates against.

**`fromRequest`: log in instead of writing a seed script.** When all a repo needs is "call the login endpoint, use what it returns":

```json theme={null}
{
  "api": {
    "serve": ["node", "dist/server.js"],
    "credentials": {
      "owner": {
        "header": "Authorization",
        "fromRequest": {
          "method": "POST",
          "path": "/auth/login",
          "json": { "email": "dev@example.com", "password": "devpassword" },
          "capture": "token",
          "template": "Bearer ${value}"
        }
      }
    }
  }
}
```

The runner makes that call once per run and the captured value becomes the credential (`capture` is a dotted path into the JSON body; `captureHeader` reads a response header instead; `template` is opt-in, and without it the value is injected verbatim). A login that can't be reached or comes back without the declared value stops the whole run as `credential-request-failed`, never a silent unauthenticated run. Because guard boots one fresh server per scenario, a token minted at preflight stays valid only if the auth state outlives that process: a stateless signed JWT, or a session row in an external datastore. `fromRequest` lives in committed `recipe.json`, so point it at a development account the repo already commits, never a real password.

A credential value destined for `Authorization` that doesn't begin with an auth-scheme token (`Bearer `, `Basic `, …) is almost always a raw token that will 401 everywhere: the run warns at start (naming the credential, never the value) and carries on.

## Next steps

<CardGroup cols={2}>
  <Card title="Seeding" icon="seedling" href="/guard/seeding">
    Mint the rows, fixtures, and principals your scenarios need.
  </Card>

  <Card title="External services" icon="cloud" href="/guard/external-services">
    App-owned fakes, scripted stubs, or real sandbox accounts.
  </Card>
</CardGroup>
