> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Guard setup

> Prepare the repo for guard: derive and prove the recipe, declare external APIs, draft the data + auth seed.

```bash theme={null}
truecourse guard setup
```

`guard setup` is the cheap preparation stage between the scan and the generator, and a **prerequisite** for it: `guard generate` refuses to run until setup has been done. It:

1. **Derives and proves the [recipe](/guard/recipe)**: install → build → boot, then a live call against a real route of every declared server.
2. **Detects the third parties and the database** the repo uses, and **declares** every detected [external API](/guard/external-services) in `recipe.json`, including ones you have no account for.
3. **Drafts the one [seed script](/guard/seeding)** that creates both the rows and the authenticated principals your scenarios need, running it for real and validating its manifest before either artifact is written.

At most two LLM calls.

## Why a separate stage

All of these facts live in `recipe.json`, and editing `recipe.json` moves the recipe fingerprint, which re-authors every section generated against it. Discovering them as a byproduct of the expensive generate stage means every fix costs a full regenerate; discovering them first means every fix is free.

The same logic is why setup declares external services you have *no account for*: the **declaration** is what enters the fingerprint, the API key is not. Handing guard a key later touches only the gitignored `scenarios/externals.local.json` and re-authors nothing.

## How discovery works

Discovery tries a **deterministic proposer first**: for a simple single-app repo (JS/TS, Python, C#) it reads your own declarations: the committed lockfile, the build script, a plain `scripts.start` argv or the `uvicorn` / `flask` / `manage.py` / `dotnet run` invocation its framework implies, `bin` for the CLI entrypoint, the derived route surface for the health path, a datastore-declaring `docker-compose` file for `services`, and your OpenAPI `securitySchemes` for credential stubs (a `valueFromEnv` name and a printed TODO, never a fabricated secret). Anything ambiguous (a workspace monorepo, two ecosystems at the root, several `bin` entries) falls back to the **LLM proposer**.

Either way the engine **verifies before anything is written**: it runs the install and build, probes the CLI entrypoint, brings the proposal's `api.services` up (and back down afterwards, pass or fail) and boots the API server to its health path, so a recipe on disk is one that actually worked. Each step names itself when it fails.

**The live endpoint probe.** Proving the server *starts* is not the same as proving it is the server your scenarios will drive: a recipe naming the wrong workspace app boots perfectly and 404s every documented path. So setup additionally calls a real route on every declared server. The bar is deliberately generous: any HTTP status passes, 401 and 404 included. Only a boot failure, an unreachable server, or 5xx on every probed route stops setup.

**The datastore is generated when your repo has none.** If the app needs a database and ships no compose file, discovery reads the connection URL your own source declares and writes **`docker-compose.guard.yml`** at the repo root: one pinned container per engine (Postgres, MySQL/MariaDB, MongoDB, Redis) on the port your URL names, with a healthcheck, plus the `api.services` that runs it. A password is never invented, and the file is never `docker-compose.yml`; that name is yours. The whole chain is verified before anything is kept (container up → your migrations → boot → health path). `docker-compose.guard.yml` is **committable** and enters the recipe fingerprint; guard never rewrites it once a recipe references it.

## Idempotence and refresh

```bash theme={null}
truecourse guard setup             # No-ops on an already-prepared repo (reports and exits)
truecourse guard setup --refresh   # Re-derive the recipe and re-draft the seed
truecourse guard setup -y          # Skip the cost confirm (with --refresh: consent to replacing the seed)
```

Replacing an existing seed script always asks first; in a non-TTY it refuses rather than clobber a hand-edited file. A refresh replaces the recipe only if the new one verifies, preserves the blocks discovery never proposes (`api.seed`, `api.externals`, `api.credentials`, `ownHosts`), and leaves git as the undo. Whatever discovery couldn't decide prints as a TODO list.

## Output

* `guard/setup.json`: the setup record + detection snapshot (gitignored).
* Whatever it wrote to `recipe.json` and the seed script; both committable, **both yours to review**.

## Read-only companions

```bash theme={null}
truecourse guard recipe      # The recipe as loaded (secrets masked) + whether its discovery inputs drifted
truecourse guard seed        # The declared seed, the script it names, and the flows blocked on missing data
truecourse guard externals   # Each external service with its state, base URL/mode, unmet requirements, blocked flows
```

Deriving lives in `guard setup` only, in exactly one place, because derivation edits `recipe.json`, which moves the recipe fingerprint, which re-authors every section generated against it.

## Next steps

<CardGroup cols={2}>
  <Card title="The recipe" icon="scroll" href="/guard/recipe">
    What setup wrote, field by field, and how to edit it.
  </Card>

  <Card title="Guard generate" icon="wand-magic-sparkles" href="/guard/generate">
    With the repo prepared, author the scenario tests.
  </Card>
</CardGroup>
