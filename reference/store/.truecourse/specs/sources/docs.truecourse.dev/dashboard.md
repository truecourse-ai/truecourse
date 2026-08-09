> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Dashboard

> One web UI for both capabilities: code findings and business-logic drift side by side.

```bash theme={null}
truecourse dashboard
```

One web UI for both capabilities: browse code findings and business-logic drift side by side, with the architecture graph, analytics, and the spec-curation + guard workflow.

![TrueCourse dashboard](https://raw.githubusercontent.com/truecourse-ai/truecourse/main/assets/screenshot.png)

## What's inside

* **Code Analysis**: architecture graph, violations list, severity/category analytics, code hotspots, trend over time; toggle rules and silence noisy ones inline.
* **Guard**: **Coverage** shows each spec doc's sections with their scenario coverage (blocked sections waiting only on a providable third party show as orange **Needs setup**, with a link to the External APIs form) and walks you through resolving spec conflicts; **Sources** manages the [llms.txt documentation sites](/guard/web-sources) registered as spec docs: add one by URL with a preview before anything is written, refresh or remove; **Scenarios** lists the committed scenario corpus with the recipe and last-generate summary, and every test reads as `View · Story · YAML`; **External APIs** shows the third parties the app calls and lets you hand guard a real or sandbox account for each (declaration committed to `recipe.json`, secrets to the gitignored overlay); **Runs** shows each run's drifts with per-failure evidence.

Dashboard-triggered scans, generates, and analyses use the same saved [LLM transport](/configuration/llm-transport) as the CLI; the dashboard reads the selection but never edits credentials.

## Commands

```bash theme={null}
truecourse dashboard                  # Start + open the dashboard
truecourse dashboard --reconfigure    # Re-prompt for console vs background service mode
truecourse dashboard --service        # Run as a background service (skips the mode prompt)
truecourse dashboard --console        # Run in this terminal (skips the mode prompt)
truecourse dashboard stop             # Stop the dashboard
truecourse dashboard status           # Show dashboard status
truecourse dashboard logs             # Tail dashboard logs (service mode only)
truecourse dashboard uninstall        # Remove the background service
```

The first `truecourse dashboard` asks whether to run in this terminal (console) or as a background service; `--reconfigure` re-asks later.

## Next steps

<CardGroup cols={2}>
  <Card title="LLM transport" icon="plug" href="/configuration/llm-transport">
    The saved transport the dashboard's scans and generates run on.
  </Card>

  <Card title="CLI reference" icon="terminal" href="/reference/cli">
    Every dashboard action has a CLI equivalent.
  </Card>
</CardGroup>
