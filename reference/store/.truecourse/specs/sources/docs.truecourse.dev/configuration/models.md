> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Models & environment

> Per-stage model selection, concurrency, timeouts, and Claude Code tuning.

## Per-stage model selection

Each LLM-powered pipeline stage resolves its model independently, so you can run cheap stages on Haiku and reserve Opus for scenario generation. Resolution precedence:

1. `TRUECOURSE_MODEL_<STAGE>` (per-stage env override)
2. `TRUECOURSE_MODEL` (global env override)
3. `.truecourse/config.json` (`llm.stages.<id>`)
4. `llm.api.model` (API mode only)
5. the built-in default

`truecourse config llm show` prints the effective model + source for every stage.

| Stage                          | Env override                      | Default |
| ------------------------------ | --------------------------------- | ------- |
| doc relevance keep/drop        | `TRUECOURSE_MODEL_SPEC_RELEVANCE` | haiku   |
| area tagging                   | `TRUECOURSE_MODEL_SPEC_AREA_TAG`  | sonnet  |
| overlap flagging               | `TRUECOURSE_MODEL_SPEC_OVERLAP`   | haiku   |
| guard section classify/extract | `TRUECOURSE_MODEL_GUARD_EXTRACT`  | sonnet  |
| guard scenario generate        | `TRUECOURSE_MODEL_GUARD_GENERATE` | opus    |
| guard recipe derivation        | `TRUECOURSE_MODEL_GUARD_RECIPE`   | sonnet  |
| guard seed drafting            | `TRUECOURSE_MODEL_GUARD_SEED`     | opus    |

<Note>
  The built-in defaults are Claude Code tier aliases, which mean nothing to a provider API. In [API mode](/configuration/llm-transport) your one configured `llm.api.model` takes their place and runs every stage. The explicit overrides above still win; in API mode they must name a model id your provider accepts.
</Note>

## Cross-stage knobs

| Variable                                     | What it does                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUECOURSE_FALLBACK_MODEL`                  | The fallback model used when the primary is overloaded (in API mode `llm.api.fallbackModel` is the last resort).                                                                                                                                                                                                 |
| `TRUECOURSE_MAX_CONCURRENCY`                 | Caps concurrent LLM calls across every stage (default `min(cpus, 4)`), and the guard runner's parallel scenario sandboxes.                                                                                                                                                                                       |
| `TRUECOURSE_MAX_API_CONCURRENCY`             | Caps concurrent api-driver scenario boots separately (default `min(TRUECOURSE_MAX_CONCURRENCY, 3)`, clamped to it): an api scenario boots a whole target server that lives for the scenario, so this bounds the number of resident servers. The api and cli pools share the `TRUECOURSE_MAX_CONCURRENCY` budget. |
| `TRUECOURSE_LLM_TIMEOUT_SCALE`               | Multiplies every stage's per-call timeout by a float (default `1`), on every transport. A slow model or proxy that trips the built-in ceilings can widen them all with one knob, e.g. `TRUECOURSE_LLM_TIMEOUT_SCALE=3`.                                                                                          |
| `TRUECOURSE_LLM_LOG` / `TRUECOURSE_LLM_DUMP` | Per-call logging.                                                                                                                                                                                                                                                                                                |

## Claude Code mode tuning

In Claude Code mode TrueCourse talks to the model via the `claude` CLI. Tune that interaction (which binary to invoke, which model to pass, timeouts, retries, and how many `claude` processes to run in parallel) through environment variables. They apply to Claude Code mode only; in API mode the provider config carries the equivalent settings.

For packaged installs, the simplest place to set them is `~/.truecourse/.env`, loaded automatically on every invocation:

```text theme={null}
CLAUDE_CODE_BINARY=claude             # override the `claude` binary on PATH (CLAUDE_CODE_BIN also accepted)
CLAUDE_CODE_MODEL=                    # Claude Code --model flag (empty = default)
CLAUDE_CODE_TIMEOUT_MS=120000         # per-call timeout (ms)
CLAUDE_CODE_MAX_RETRIES=2             # retry attempts on parse/validation failure
CLAUDE_CODE_MAX_CONCURRENCY=10        # max concurrent `claude` processes per run
```

**`CLAUDE_CODE_MAX_CONCURRENCY`** caps how many Claude CLI processes TrueCourse spawns in parallel during a single run. Default `10`. Raise it on CI runners with spare headroom; lower it on resource-constrained machines (e.g. 8 GB laptops, shared VMs) to avoid OOM on large repos.

For a one-off override, prefix the command:

```bash theme={null}
CLAUDE_CODE_MAX_CONCURRENCY=2 truecourse analyze
```

## Preflight

Every command that uses Claude (`analyze` with LLM rules, `spec scan`, `guard setup`, `guard generate`) runs a quick up-front preflight: one tiny `claude` call to confirm the CLI is installed and logged in, aborting with the CLI's own error message if not, so an expired login is caught immediately instead of failing every extraction subprocess at the end of a long run. In API mode that preflight is skipped and the saved provider configuration is validated instead.

## Cost estimates

`spec scan` and `guard generate` print a pre-flight **token + ceiling-cost estimate** before calling the LLM: token math is deterministic and offline; cost multiplies the high end of each stage's call range by per-token prices and ignores prompt-caching discounts, so the real bill lands at or below it. Both estimates are cache-aware (they count only the docs/sections that actually changed), and when nothing changed the confirm prompt is skipped.

Model prices are fetched daily from OpenRouter and cached under `~/.truecourse/cache/`. Set `TRUECOURSE_NO_PRICE_FETCH=1` to skip the network and use bundled list prices (air-gapped setups).

## Next steps

<CardGroup cols={2}>
  <Card title="Storage" icon="database" href="/configuration/storage">
    Every file TrueCourse writes, per-repo and per-user.
  </Card>

  <Card title="CLI reference" icon="terminal" href="/reference/cli">
    The full environment-variable table alongside every command.
  </Card>
</CardGroup>
