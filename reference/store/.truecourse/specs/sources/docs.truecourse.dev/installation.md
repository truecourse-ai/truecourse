> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Installation

> Prerequisites, the npm package, and the first-run LLM choice.

## Install the CLI

```bash theme={null}
npm install -g truecourse
```

This puts the `truecourse` command on your PATH; every example in these docs uses it. Prefer not to install globally? Run any command one-off with `npx truecourse <command>` instead.

## Prerequisites

| Requirement                                                           | Needed for                                | Notes                                                                                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js ≥ 20**                                                      | everything                                |                                                                                                                                                                            |
| **[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI** | LLM-powered work in the default transport | Optional. The default `cli` transport spawns `claude -p` per call; deterministic rules, [API mode](/configuration/llm-transport), and the `agent` transport don't need it. |
| [**.NET 8 SDK**](https://dotnet.microsoft.com/download)               | analyzing C# only                         | C#'s semantic rules run in a Roslyn host you build once: `dotnet build -c Release tools/csharp-roslyn-host` (or point `TRUECOURSE_ROSLYN_HOST` at a prebuilt binary).      |

<Warning>
  Analyzing a repo that contains C# without the Roslyn host **fails fast** with a build-the-host message. There is deliberately no tree-sitter-only fallback, since a silent half-analysis is worse than a clear error.
</Warning>

## First run: the LLM choice

The very first `truecourse` command you run, whichever it is, asks once and saves the answer:

```text theme={null}
◆ How should TrueCourse run its LLM calls?
│ ● Claude Code (recommended)   uses your existing Claude Code login, per-stage model tiers, no API key needed
│ ○ API — bring your own key    Anthropic, OpenAI, AWS Bedrock, GitHub Copilot
```

**Claude Code** saves the choice and continues into your command. **API** walks provider → model → API key → optional fallback model and base URL, then makes one live call to prove the configuration works; a configuration that fails its probe is never saved.

In a non-interactive shell (CI, scripts, git hooks) nothing is asked and nothing is written: Claude Code stays the default. Change the selection any time with [`truecourse config llm setup`](/configuration/llm-transport).

## What gets created

No setup step and no database: the first `truecourse analyze` (or `spec scan`) creates `.truecourse/` in your repo and stores everything there as plain JSON files. A few of those files are committable and travel with the repo through git; the rest are local-only and added to `.truecourse/.gitignore` automatically. See [Storage](/configuration/storage) for the full layout.

## Next steps

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    First analysis and first guard cycle.
  </Card>

  <Card title="LLM transport" icon="plug" href="/configuration/llm-transport">
    Claude Code vs provider API, credentials, and per-run overrides.
  </Card>
</CardGroup>
