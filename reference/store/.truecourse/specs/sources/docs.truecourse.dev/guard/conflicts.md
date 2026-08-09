> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Resolving conflicts

> Review and resolve flagged within-area doc overlaps: pick a side or dismiss.

When two docs in the same area may disagree, [`spec scan`](/guard/spec-scan) flags an **overlap**. Only genuine within-area disagreements flag; docs that agree never surface. Each flagged overlap awaits a verdict from you: pick which doc is right, or dismiss it as a detector false-positive. The losing side's disputed claim is suppressed at [`guard generate`](/guard/generate), so scenarios are only authored from the claims you stand behind.

Resolve conflicts from the CLI (agent-friendly; every command has `--json`) or in the [dashboard](/dashboard)'s Guard → Coverage tab, which walks you through each one (pick / write custom / mark superseded / include skipped doc).

## Inspect

```bash theme={null}
truecourse spec conflicts list               # List flagged overlaps still awaiting a verdict (numbered)
truecourse spec conflicts list --json
truecourse spec conflicts show <n|area>      # A conflict's disputed section passages with path:line anchors
truecourse spec conflicts show 2 --json
```

`show` prints the actual disputed passages from both docs with `path:line` anchors, so you can judge without opening files.

## Resolve

```bash theme={null}
# Pick a side (one conflict): this doc is right; the other's disputed claim
# is suppressed at generate
truecourse spec conflicts resolve 3 --right docs/BILLING.md

# Not a real conflict: dismiss
truecourse spec conflicts resolve 2 --dismiss
truecourse spec conflicts resolve 2 5 7 --dismiss          # Bulk-dismiss by index
truecourse spec conflicts resolve --area core/x --dismiss  # Dismiss every conflict in an area

# Apply the verify pass's recommendation (pick-a-side / dismiss;
# a fix-doc recommendation prints guidance instead)
truecourse spec conflicts resolve 4 --recommended

# Attach a rationale to any verdict
truecourse spec conflicts resolve 3 --right docs/BILLING.md --note "ADR-12 superseded the old pricing doc"
```

Verdicts are stored in the committable `specs/decisions.json`, keyed by dispute identity; they survive re-scans and travel with the repo.

## Next steps

<CardGroup cols={2}>
  <Card title="Guard setup" icon="screwdriver-wrench" href="/guard/setup">
    With the corpus settled, prepare the repo for scenario authoring.
  </Card>

  <Card title="Guard generate" icon="wand-magic-sparkles" href="/guard/generate">
    Author scenario tests from the resolved spec sections.
  </Card>
</CardGroup>
