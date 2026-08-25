> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Seeding

> api.seed mints the rows, fixtures, and authenticated principals your scenarios need, once per run.

Some claims can't be asserted from an empty database: they need a real account, a real token, or a row that already exists. `api.seed` in the [recipe](/guard/recipe) is the **authenticated one-shot** that mints them: one command you write (or let [`guard setup`](/guard/setup) draft), run once per run, whose output the whole run reuses:

```json theme={null}
{
  "build": "pnpm build",
  "api": {
    "serve": ["node", "dist/server.js"],
    "healthPath": "/health",
    "services": { "up": "docker compose up -d db", "down": "docker compose down" },
    "seed": {
      "command": "node scripts/guard-seed.mjs",
      "provides": {
        "credentials": {
          "owner": { "header": "Authorization", "description": "org owner", "satisfies": "bearerAuth" }
        },
        "fixtures": { "org": ["id", "slug"] }
      }
    }
  }
}
```

* `command`: one shell command, run in the repo root.
* `provides`: the **static declaration** of what the seed promises to emit. Credentials each carry a `header`, an optional `description` naming the principal ("org owner", "regular member") so authoring picks the right one for a role-sensitive claim, and an optional `satisfies` naming the OpenAPI security scheme they fulfill. Fixtures are `name → [field, …]`. **No values**: no secret ever reaches `recipe.json` or the recipe fingerprint. Changing `provides` *does* re-key authoring, since it changes what scenarios can be written against.
* A credential name may not be declared in both `api.credentials` and `api.seed.provides.credentials`; one name has exactly one source.

## The manifest

The runner sets `GUARD_SEED_OUT` to a temp file path; the command writes its results there as JSON:

```json theme={null}
{
  "credentials": { "owner": { "value": "Bearer eyJhbGci…" } },
  "fixtures":    { "org": { "id": 42, "slug": "acme" } }
}
```

Every declared credential must come back with a non-blank string `value`, and every declared fixture field must be present. A gap is a hard **`seed-failed`** stop that names what's missing, never a silent skip. Fixture values keep their native JSON type; a manifest number stays a number.

**When it runs:** once per run, in the repo root, only when the run has api scenarios: after `api.services.up` (so migrations and the datastore are ready) and before any server boots. It runs with the server's environment, so a `DATABASE_URL` you declared for the server reaches the seed too.

## Using it in scenarios

* `{{cred:owner}}`: seeded credentials merge into the same pool as static ones. Credentials resolve in **header values only**, never in a path, body, or expectation.
* `{{fixture:org.id}}`: fixtures are ids and handles, not secrets, so they resolve **anywhere**: path, query string, header value, request body, and expectation matchers. When a JSON leaf is exactly one placeholder it substitutes the native value (`{"orgId": "{{fixture:org.id}}"}` sends the number `42`).
* Referencing a fixture or field the seed never provided is a scenario error, not a silent empty string.

**Redaction:** every resolved credential value, seeded or static, is masked out of all evidence transcripts and failure output as `«cred:<name>»`. Fixtures are deliberately *not* redacted: they're the ids you want to read in a transcript.

## What survives, and what doesn't

Guard boots **one fresh server per scenario**. Seeded state therefore survives only when it lives in an external datastore brought up by `api.services.up`: a Postgres, a Redis, anything outside the process. If your app keeps state in memory, either give it a real store for guard runs (via `api.env`) or have each scenario create what it needs through the API itself.

## Let guard draft it

[`truecourse guard setup`](/guard/setup) drafts the seed script for you, but only when it can be honest about it: a database whose schema it actually parsed, a recipe with an `api` block, and no `api.seed` already (an existing seed is yours; `--refresh` replaces it, and asks first). The draft is grounded in your repo: the parsed tables and foreign-key graph, the ORM your files import, the connection env var your server reads, your HTTP route surface, your OpenAPI security schemes, and excerpts of the specs themselves. Neither artifact is written until the engine has proved them by running the script for real and booting the server against the state it left behind. Review and commit **both** artifacts; the script is real code that writes to your datastore, and reviewing it is the point.

A drafted seed also records `api.seed.script`, the script file path. It's optional and the runner ignores it; its one job is staleness: the recipe fingerprint hashes that file's content, so editing the seed re-authors the flows written against the rows it creates. Add it to a hand-written seed for the same guarantee.

```bash theme={null}
truecourse guard seed    # Read-only: the declared seed, its script, and the flows blocked on missing data
```

## Next steps

<CardGroup cols={2}>
  <Card title="External services" icon="cloud" href="/guard/external-services">
    Handle the third parties your app calls: fakes, stubs, or real accounts.
  </Card>

  <Card title="Guard generate" icon="wand-magic-sparkles" href="/guard/generate">
    Author scenarios against the seeded world.
  </Card>
</CardGroup>
