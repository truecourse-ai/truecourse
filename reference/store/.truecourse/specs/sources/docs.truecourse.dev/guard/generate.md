> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Guard generate

> Author spec-section-bound scenario tests: classify → generate → birth-validate.

```bash theme={null}
truecourse guard generate
```

`guard generate` splits each kept doc into sections and, per section:

<Steps>
  <Step title="Classify">
    Decides whether the section makes a claim a driver can assert. Two drivers today: `cli` invokes your project's binary, `api` drives your HTTP service; web/tui drivers are planned. A non-testable verdict carries a one-sentence reason and surfaces as a visible coverage gap; nothing is silently skipped.
  </Step>

  <Step title="Author">
    Writes one or more declarative YAML scenarios from the section's claim plus the code. Authoring is grounded in an analysis of the app's own source (its route surface, the fields each handler actually requires, and the upstream requests it sends), which is what prevents scenarios against routes that don't exist or bodies missing required fields. (This grounding is JS/TS only today.)
  </Step>

  <Step title="Birth-validate">
    Runs each new scenario immediately; the outcome becomes the test's status. Every authored test is **committed**, so a test that fails at birth (the spec and the code already disagree) lands as a failing test you can open, re-run, and resolve, not a separate species of report entry.
  </Step>
</Steps>

<Note>
  [`truecourse guard setup`](/guard/setup) is a **prerequisite**: generate refuses to run until the repo has been prepared (recipe proved, external APIs declared, seed drafted).
</Note>

## Authoring guarantees

* **Worked examples are byte-for-byte.** A section's own worked example (a fenced block) is seeded into its test verbatim, never paraphrased, and the engine byte-checks the committed scenario against the doc's bytes.
* **Two-sided promises get both halves.** "Valid X is accepted, invalid X is rejected" gets steps for both directions, so exclusion logic that silently breaks can't stay green.
* **An inert corpus aborts the run.** When a large sample of birth steps is overwhelmingly inert (a CLI entry answering everything instantly with nothing, or a server answering every route with the same empty status), generate aborts as a recipe failure and writes nothing, instead of committing a green corpus that proves nothing.

## Output

All committable, so the whole team runs the same tests:

| File                                  | Contents                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `.truecourse/scenarios/<area>/*.yaml` | The scenario tests.                                                                              |
| `.truecourse/scenarios/manifest.json` | Section ↔ scenario bindings + section fingerprints, so re-generates only touch changed sections. |

A gitignored `guard/result.json` records the last generate's summary (written/settled counts, per-section gap reasons, detected external services, call+token+cost totals); `truecourse guard status` and the dashboard render it.

## Incremental re-generates

Section fingerprints in the manifest mean a re-generate only touches sections whose spec text actually changed; unchanged sections keep their scenarios and cost nothing. Like [`spec scan`](/guard/spec-scan), generate prints a cache-aware **cost estimate** up front and asks for confirmation (`-y` / `--yes` skips it); when nothing changed, there's nothing to confirm.

## Flows

Generate synthesizes **flows** (the user-visible journeys the spec describes) and binds tests to them. They're inspectable and curatable without an LLM:

```bash theme={null}
truecourse guard flows                        # List flows with per-surface coverage
truecourse guard flows --show <id>            # One flow: goal, milestones, binds, surfaces, journeys, gaps
truecourse guard flows --show <id> --story    # The flow's committed tests in plain words
truecourse guard flows dismiss <flow-id>      # Rule a flow out of testing (--note <text>); next generate drops it and deletes its tests
truecourse guard flows undismiss <flow-id>    # Put it back; next generate authors tests for it again
```

**Every committed test can be read in plain words.** A test's YAML carries the flow's promise, and one shared renderer turns the whole file into sentences: the world it's placed in, what each step does, what it remembers, and what must be true. The dashboard's test detail offers `View · Story · YAML`; `--story` prints the same words in the terminal.

## Findings: whose fault is it?

A generate produces two very different results, and only one of them is work for you:

| Class          | Meaning                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **drift**      | A test that **committed red**: the code and the doc disagree. `guard run` reproduces it, CI breaks on it.                               |
| **defect**     | A scenario guard itself judged faulty. Nothing was committed, nothing in your repo is broken; the flow re-authors on the next generate. |
| **escalation** | A defect that re-generation keeps failing to fix, escalated to a real task.                                                             |

```bash theme={null}
truecourse guard findings                     # Findings by flow (drift vs tool defect) + the auto-resolved ledger
truecourse guard findings --kind drift        # One class: drift | defect | escalation
truecourse guard findings --flow <id>         # Only this flow
truecourse guard findings --json              # The agent-facing envelope
```

The dashboard draws the same line: a tool defect is a muted marker beside the flow's status, never a red one, and each failing test carries its triage verdict (*code drift*, *doc drift*, *our defect*) with the concrete unblock beside it.

## Next steps

<CardGroup cols={2}>
  <Card title="Guard run" icon="play" href="/guard/run">
    Run the committed scenarios deterministically, in CI.
  </Card>

  <Card title="Dashboard" icon="browser" href="/dashboard">
    Coverage, flows, stories, and findings, visually.
  </Card>
</CardGroup>
