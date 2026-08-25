> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# LLM transport

> How TrueCourse reaches the model: Claude Code, a provider API, or an agent mailbox.

Every LLM-powered step (`analyze`'s LLM rules, and the whole Spec → Guard pipeline: `spec scan`, `guard setup`, `guard generate`) reaches the model through a pluggable **transport**:

| Mode                             | How it reaches the model                                                            | Needs                                               |
| -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Claude Code** (`cli`, default) | spawns `claude -p …` per call                                                       | the `claude` binary on PATH, signed in. No API key. |
| **API** (`api`)                  | calls your provider directly: **Anthropic, OpenAI, AWS Bedrock, or GitHub Copilot** | a model id + an API key. No `claude` binary.        |
| **`agent`**                      | a **filesystem mailbox** under `--io <dir>`                                         | nothing: no `claude` binary, no API key             |

The choice between Claude Code and API is a **saved, per-user setting**; `agent` is a per-run mode for an orchestrating agent. All three send identical prompts and parse identical schema-validated JSON; only the delivery differs.

## First run

The very first `truecourse` command you run, whichever it is, asks once and saves the answer:

```text theme={null}
◆ How should TrueCourse run its LLM calls?
│ ● Claude Code (recommended)   uses your existing Claude Code login, per-stage model tiers, no API key needed
│ ○ API — bring your own key    Anthropic, OpenAI, AWS Bedrock, GitHub Copilot
```

**Claude Code** saves the choice and continues into your command. **API** walks provider → model → API key → optional fallback model and base URL, then makes one live call to prove the configuration works; a configuration that fails its probe is never saved. In a non-interactive shell (CI, scripts, git hooks) nothing is asked and nothing is written: Claude Code stays the default.

## truecourse config llm

```bash theme={null}
truecourse config llm setup            # Re-run the wizard: pick the transport, store API credentials
truecourse config llm show             # Active transport, saved API config (key masked), per-stage models
truecourse config llm test             # One live call against the saved API configuration
truecourse config llm use <mode>       # Flip the saved transport: claude-code | api
```

`setup` takes flags for non-interactive use (CI, dotfiles); passing `--transport` skips every prompt:

```bash theme={null}
truecourse config llm setup --transport claude-code

truecourse config llm setup --transport api \
  --provider anthropic --model claude-sonnet-4-5 --api-key-stdin < key.txt

truecourse config llm setup --transport api \
  --provider openai --model gpt-4o --api-key-env OPENAI_API_KEY --no-test
```

| Flag                                                                       | What it does                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `--transport <claude-code\|api>`                                           | what to save; its presence is what makes the run non-interactive              |
| `--provider <anthropic\|openai\|bedrock\|copilot>`                         | required in api mode                                                          |
| `--model <id>`                                                             | required in api mode; every stage runs on it                                  |
| `--fallback-model <id>`                                                    | tried once if the primary call errors                                         |
| `--api-key-stdin`                                                          | read the key from stdin (recommended)                                         |
| `--api-key-env <VAR>`                                                      | store the *name* of an env var; the key is read fresh on every run            |
| `--api-key <key>`                                                          | discouraged; it stays in your shell history (the command warns)               |
| `--base-url <url>`                                                         | gateway or self-hosted endpoint speaking the provider's protocol              |
| `--header <k=v>`                                                           | extra request header (repeatable)                                             |
| `--region` / `--access-key-id` / `--secret-access-key` / `--session-token` | Bedrock; omit any of them to fall through to the ambient AWS credential chain |
| `--no-test`                                                                | save without the live provider probe (air-gapped setups)                      |

## Where the selection lives

The selection lives in `~/.truecourse/config.json`: per-user, written `0600` inside a `0700` directory, deliberately **not** the committable per-repo `.truecourse/config.json`. `TRUECOURSE_HOME` relocates the whole directory.

```jsonc theme={null}
{
  "llm": {
    "transport": "api",                     // "claude-code" (default) | "api"
    "api": {
      "provider": "anthropic",              // anthropic | openai | bedrock | copilot
      "model": "claude-sonnet-4-5",         // required in api mode; every stage runs on it
      "fallbackModel": "claude-haiku-4-5",  // optional: tried once if the primary errors
      "apiKey": "sk-ant-…",                 // optional: omit to take the key from the environment
      "apiKeyEnv": "MY_KEY_VAR",            // optional: NAME of an env var, resolved on every run
      "baseURL": "https://gateway/v1",      // optional: gateway / self-hosted endpoint
      "headers": { "X-Team": "core" },      // optional
      "region": "us-west-2"                 // bedrock only, with accessKeyId / secretAccessKey / sessionToken
    }
  }
}
```

The `api` block persists even while `transport` is `claude-code`, so flipping between the two never re-asks for credentials.

**Where the key comes from**, in order: `llm.api.apiKey`, then the variable named by `llm.api.apiKeyEnv`, then the provider's standard variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `COPILOT_API_KEY`). Bedrock has none of these: omitted credentials fall through to the ambient AWS chain. Store no key at all and TrueCourse reads it from the environment on every run.

**`TRUECOURSE_LLM_TRANSPORT=claude-code|api`** overrides the saved selection for a single run or a CI job.

In API mode nothing shells out to `claude`, so its login preflight is skipped; instead an unusable provider configuration aborts up front, before any pipeline work or cost, with a pointer to `truecourse config llm setup`. Credentials are entered through the CLI or the config file only: the dashboard reads the selection but never edits it.

## Per-run override: --llm-transport

`--llm-transport <cli|agent|api>` overrides the saved selection for one command: `cli` forces Claude Code, `api` forces the configured provider, `agent` uses the mailbox. Accepted by `analyze`, `spec scan`, `guard setup`, and `guard generate`.

<Note>
  On `analyze`, `--llm` / `--no-llm` is a *separate* flag: it decides **whether** LLM rules run; `--llm-transport` decides **how** to reach the model.
</Note>

```bash theme={null}
# whatever you selected at first run
truecourse analyze --llm
truecourse guard generate

# force one mode for this run
truecourse analyze --llm --llm-transport api
truecourse spec scan      --llm-transport cli

# agent transport: the tool parks prompts in ./io and an external agent answers them
truecourse analyze --llm --llm-transport agent --io ./io
truecourse spec scan      --llm-transport agent --io ./io
truecourse guard generate --llm-transport agent --io ./io
```

### The agent mailbox

In **`agent`** mode the tool doesn't call the model itself: for each prompt it writes `requests/<id>.json` (`{ stage, system, user, schema, … }`) into the `--io` directory and waits for a matching `responses/<id>.json` (`{ text }`). An orchestrating agent that is itself an LLM (e.g. a [Claude Code routine](https://code.claude.com/docs/en/routines)) watches that directory and answers each prompt. This lets guard generation and `analyze`'s LLM rules run **inside a headless cloud session with no `claude` binary and no API key**.

## Next steps

<CardGroup cols={2}>
  <Card title="Models & environment" icon="microchip" href="/configuration/models">
    Per-stage model selection, concurrency, and timeouts.
  </Card>

  <Card title="Storage" icon="database" href="/configuration/storage">
    Where the per-user config lives, and everything else on disk.
  </Card>
</CardGroup>
