> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Telemetry

> What anonymous usage data is collected, and how to opt out.

TrueCourse collects anonymous usage data to improve the product: one event per command (`analyze`, `spec_scan`), each carrying only coarse, bucketed counts (file/finding *ranges*, duration range), the surface (CLI vs dashboard), OS, and tool version.

**No source code, file paths, identities, or violation details are collected.** Telemetry is automatically disabled in CI environments.

```bash theme={null}
truecourse telemetry status           # Check telemetry status
truecourse telemetry disable          # Opt out of anonymous telemetry
truecourse telemetry enable           # Opt back in
```

Or set `TRUECOURSE_TELEMETRY=0` to opt out via the environment.

## Next steps

<CardGroup cols={2}>
  <Card title="CLI reference" icon="terminal" href="/reference/cli">
    Every command and flag, including the environment variables.
  </Card>

  <Card title="Dashboard" icon="browser" href="/dashboard">
    The web UI over the same local store.
  </Card>
</CardGroup>
