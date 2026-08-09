> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Guard run

> Run the committed scenarios deterministically: a CI gate with no LLM in the loop.

```bash theme={null}
truecourse guard run
```

`guard run` is fully deterministic: it builds the repo via the [recipe](/guard/recipe), executes every committed scenario (including the ones that were already failing at birth), and writes the run to `.truecourse/guard/`. A test that was red at birth simply comes back green once the code catches up. It exits non-zero on any drift, so it drops straight into CI. **No LLM, no API key, no `claude` binary.**

```bash theme={null}
truecourse guard run --scenario <id>    # Run a single scenario
truecourse guard run --verbose          # One ✓ line per pass (default shows failures only)
```

For api-driver scenarios the runner boots one fresh server per scenario in an isolated sandbox, runs `api.services.up` and the [seed](/guard/seeding) once per run, and points provided [external services](/guard/external-services) through their fault-scriptable proxies.

## Not every red test is drift

A scenario walks a flow: some steps assert a spec claim (they carry a milestone), others only prepare the world (the seeding request at the head of a flow, a login). When the step that fails is one of the *preparation* steps, the run annotates the result **blocked precondition**: the scenario still fails, but the documented behavior was never actually exercised, so the fix is the setup (seed the row, declare the fixture, supply the credential), not the code. The CLI prints it on its own line under the failure and the dashboard marks the test "setup failed", distinctly from a real expectation mismatch. It's an annotation only; it never changes an outcome and never softens a CI gate.

## Reading the results

```bash theme={null}
truecourse guard status     # Compact summary: setup state, section coverage, last run, last generate (LLM-free)
truecourse guard drifts     # The latest run's non-pass scenarios, most severe first
truecourse guard drifts --all --json    # Every drift, machine-readable
```

A failing scenario means the bound spec section and the code disagree: a drift or a bug, the developer's call. Each failure carries an evidence transcript under `.truecourse/guard/evidence/<runId>/` showing exactly what the scenario ran and what came back (credential and external-service values are masked). The [dashboard](/dashboard)'s Guard → Runs view shows each run's drifts with the per-failure evidence inline.

## The run store

`.truecourse/guard/` mirrors the analyze store:

| Path                           | Contents                                           | Committable                                                        |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------ |
| `runs/<iso>_<short-uuid>.json` | Per-run snapshots                                  | No                                                                 |
| `LATEST.json`                  | Materialized current run state, the guard baseline | **Yes**; commit after merging to `main`, not from feature branches |
| `history.json`                 | Append-only per-run summaries                      | No                                                                 |
| `evidence/<runId>/`            | Per-failure transcripts                            | No                                                                 |
| `setup.json`                   | Last `guard setup` record + detection snapshot     | No                                                                 |
| `result.json`                  | Last `guard generate` summary                      | No                                                                 |

## In CI

```yaml theme={null}
# e.g. GitHub Actions
- run: npx truecourse guard run
```

The exit code is the gate: `0` when every scenario passes, non-zero on any drift. Scenarios, recipe, and manifest are committed, so CI needs no LLM configuration at all.

<Note>
  `TRUECOURSE_MAX_CONCURRENCY` caps the runner's parallel scenario sandboxes, and `TRUECOURSE_MAX_API_CONCURRENCY` separately bounds how many api-driver servers are resident at once; see [Models & environment](/configuration/models).
</Note>

## Next steps

<CardGroup cols={2}>
  <Card title="Dashboard" icon="browser" href="/dashboard">
    Review runs, drifts, and per-failure evidence visually.
  </Card>

  <Card title="Storage" icon="database" href="/configuration/storage">
    What the guard store holds, and which files to commit.
  </Card>
</CardGroup>
