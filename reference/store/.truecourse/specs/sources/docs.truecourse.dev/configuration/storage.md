> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Storage

> Everything is plain JSON files: what lives where, and what to commit.

TrueCourse stores everything as JSON files. **No database.** There are two locations: a per-repo store under `<repo>/.truecourse/`, and a per-user store under `~/.truecourse/`.

## Per-repo: .truecourse/

Created on first use. The committable files travel with the repo through git; everything else is added to `.truecourse/.gitignore` automatically.

| Path                                                                                            | Contents                                                                          | Committable                                    |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| `LATEST.json`                                                                                   | Materialized current analysis state; the diff baseline                            | **Yes**                                        |
| `config.json`                                                                                   | Per-repo settings: rule categories, `disabledRules`, LLM toggles, spec scan scope | **Yes**                                        |
| `hooks.yaml`                                                                                    | Pre-commit hook policy                                                            | **Yes**                                        |
| `analyses/`                                                                                     | Per-analysis snapshot files                                                       | No                                             |
| `history.json`                                                                                  | Append-only summaries for cross-analysis queries                                  | No                                             |
| `diff.json`                                                                                     | Current diff analysis, overwritten each diff run                                  | No                                             |
| `ui-state.json`                                                                                 | Graph positions + collapse state                                                  | No                                             |
| `logs/`                                                                                         | Per-repo analyze logs                                                             | No                                             |
| `.analyze.lock`                                                                                 | Transient lock held during an analyze                                             | No                                             |
| `specs/corpus.json`                                                                             | Curated spec corpus                                                               | **Yes**                                        |
| `specs/decisions.json`                                                                          | User-authored spec resolutions                                                    | **Yes**                                        |
| `specs/sources.json` + `specs/sources/<id>/`                                                    | Registered llms.txt sites + their fetched pages                                   | **Yes**                                        |
| `scenarios/`                                                                                    | Guard scenarios + recipe + manifest + guard decisions                             | **Yes**                                        |
| `scenarios/externals.local.json`                                                                | External-account base URLs + API keys                                             | No (secrets)                                   |
| `guard/LATEST.json`                                                                             | Guard run baseline                                                                | **Yes**                                        |
| `guard/runs/`, `guard/history.json`, `guard/evidence/`, `guard/setup.json`, `guard/result.json` | Guard run history, evidence, setup record, last-generate summary                  | No                                             |
| `.cache/`                                                                                       | Per-stage LLM caches, what makes re-runs cheap                                    | No; safe to delete, re-derived on the next run |

<Warning>
  The committable baselines (`LATEST.json`, `guard/LATEST.json`, `specs/corpus.json`) follow one convention: **commit them only after merging to `main`** (re-run the command, commit the result). Committing them from feature branches makes two PRs conflict on a large generated JSON.
</Warning>

## Per-user: \~/.truecourse/

| Path                           | Contents                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `config.json`                  | The [LLM transport selection](/configuration/llm-transport) and API provider credentials. Written `0600` in a `0700` dir. |
| `.env`                         | Optional [environment tuning](/configuration/models), loaded automatically on every invocation.                           |
| `registry.json`                | Known project paths + `lastAnalyzed`.                                                                                     |
| `logs/`                        | Dashboard + install logs.                                                                                                 |
| `cache/openrouter-prices.json` | Cached model prices for the pre-flight cost estimate. Derived, safe to delete.                                            |

Set `TRUECOURSE_HOME` to relocate the whole per-user directory.

## Write safety

Writes go through an atomic write-to-tmp + rename, so a crash never leaves a half-written store. Concurrent analyses are prevented by the `.analyze.lock` file. The server walks up from `cwd` looking for `.truecourse/`, so commands work from anywhere inside the repo.

## Next steps

<CardGroup cols={2}>
  <Card title="Baselines & diff" icon="code-compare" href="/analyze/baseline-and-diff">
    The commit conventions in practice, on the analyze side.
  </Card>

  <Card title="Telemetry" icon="chart-simple" href="/configuration/telemetry">
    What anonymous usage data is collected, and how to opt out.
  </Card>
</CardGroup>
