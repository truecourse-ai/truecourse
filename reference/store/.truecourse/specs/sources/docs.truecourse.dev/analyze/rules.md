> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Rules

> Configure rule categories, LLM rules, and individual rules per repository.

Configure which rule categories and LLM-powered rules are enabled per repository. All of it is stored in the committable `<repo>/.truecourse/config.json`, so your team shares one policy.

## Categories

```bash theme={null}
truecourse rules categories                    # Show enabled/disabled
truecourse rules categories --enable style     # Enable a category
truecourse rules categories --disable style    # Disable a category
truecourse rules categories --reset            # Reset to global default
```

## LLM-powered rules

```bash theme={null}
truecourse rules llm                           # Show LLM rules status
truecourse rules llm --enable                  # Enable LLM rules
truecourse rules llm --disable                 # Disable LLM rules
```

LLM rules also honor the per-run flags on analyze: `truecourse analyze --llm` runs them (pre-approving the cost estimate), `--no-llm` skips them for that run.

## Individual rules

```bash theme={null}
truecourse rules list                          # List rules with on/off status
truecourse rules list --disabled               # Show only disabled rules
truecourse rules list --domain security        # Only rules in one domain
truecourse rules list --search sql             # Filter by key, name, or description
truecourse rules list --language python        # Per-language support status
truecourse rules disable <ruleKey>             # Disable a single rule
truecourse rules enable <ruleKey>              # Re-enable a single rule
truecourse rules reset [ruleKey]               # Clear per-rule overrides (one or all)
```

Disabled rules are skipped at analyze time (no detection cost, no LLM calls) and any existing violations from them are hidden from the dashboard and `truecourse list` until re-enabled. The list of disabled rule keys lives in `<repo>/.truecourse/config.json` under `disabledRules`, which is intended to be committed.

<Tip>
  In the [dashboard](/dashboard) you can also toggle rules from the Rules panel (Shield icon in the top-right) or silence a noisy rule directly from any violation card via the **⋮** menu → **Disable rule for this repo**.
</Tip>

## Next steps

<CardGroup cols={2}>
  <Card title="Excluding files" icon="file-slash" href="/analyze/excluding-files">
    Keep generated and vendored code out of the analysis.
  </Card>

  <Card title="LLM transport" icon="plug" href="/configuration/llm-transport">
    How LLM rules reach the model: Claude Code or a provider API.
  </Card>
</CardGroup>
