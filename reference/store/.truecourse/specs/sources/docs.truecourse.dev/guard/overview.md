> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> Turn your docs into deterministic scenario tests that catch business-logic drift.

TrueCourse builds a curated spec corpus from your docs, then **guards** it: an LLM authors declarative scenario tests bound to each spec section once, and running them is fully deterministic, with no model in the verification loop. A failing scenario means "this section and the code disagree" (a drift or a bug; the developer's call).

This is a separate pipeline from [`analyze`](/analyze/overview): it answers a different question, has different prerequisites (it reads your docs), and runs on a different time scale.

<Note>
  **Prerequisites:** `spec scan`, `guard setup`, and `guard generate` need an [LLM transport](/configuration/llm-transport). By default they shell out to the Claude Code CLI (`claude -p`); install Claude Code and sign in once, or point them at a provider API with `truecourse config llm setup`. `guard run` needs neither; it's deterministic.

  The spec → guard track also requires a **git repository**, because TrueCourse's baselines are commit-anchored. On a non-git folder these commands stop with a clear message.
</Note>

## The pipeline

Stages run in order, each producing committable artifacts the next consumes:

<Steps>
  <Step title="Spec consolidation: truecourse spec scan">
    Walks every markdown file in the repo (PRDs, ADRs, RFCs, READMEs, design notes) plus any OpenAPI / Swagger doc, optionally joined by registered [llms.txt documentation sites](/guard/web-sources). A deterministic pre-filter and an LLM relevance filter drop non-spec material, then each kept doc is tagged into **areas** and within-area **overlaps** are flagged where two docs may disagree. Output: `.truecourse/specs/corpus.json` and `specs/decisions.json`, both committable. See [Spec scan](/guard/spec-scan) and [Resolving conflicts](/guard/conflicts).
  </Step>

  <Step title="Guard setup: truecourse guard setup">
    The cheap preparation stage, and a **prerequisite** for generate: it derives and *proves* the [recipe](/guard/recipe) (install → build → boot, then a live call against a real route of every declared server), detects the third parties and the database the repo uses, declares every detected [external API](/guard/external-services) in `recipe.json`, and drafts the one [seed script](/guard/seeding) that creates the rows and authenticated principals your scenarios need, running it for real before anything is written. At most two LLM calls. See [Guard setup](/guard/setup).
  </Step>

  <Step title="Guard generation: truecourse guard generate">
    Splits each kept doc into sections and, per section: **classifies** whether the section makes a claim a driver can assert (two drivers today: `cli` invokes your project's binary, `api` drives your HTTP service), **authors** one or more declarative YAML scenarios from the section's claim plus the code, and **birth-validates** each one by running it immediately; the outcome becomes the test's status. Every authored test is committed, so a test that fails at birth lands as a **failing test** you can open, re-run, and resolve. See [Guard generate](/guard/generate).
  </Step>

  <Step title="Guard run: truecourse guard run">
    Fully deterministic: builds the repo via the recipe, executes every committed scenario, including the ones that were already failing at birth, and writes the run to `.truecourse/guard/`. A test that was red at birth simply comes back green once the code catches up. Exits non-zero on any drift, so it drops straight into CI. No LLM, no API key, no `claude` binary. See [Guard run](/guard/run).
  </Step>
</Steps>

## Bidirectional binding

The section ↔ scenario binding works in both directions:

* **Code changed** → its scenarios fail (code-side drift).
* **Spec section edited** → its scenarios go stale (spec-side drift).

The spec document itself becomes the coverage UI: every section visibly carries its proof and its status.

## What it catches

Any documented behavior a scenario can drive and assert (today through your project's CLI or its HTTP API; web/tui drivers are planned): wrong responses and exit codes, missing or mistyped output fields, illegal state transitions, bypassed validation and auth rules, silently-dropped side effects, formulas producing wrong results, plus the reverse direction: spec sections whose scenarios went stale because the docs changed out from under them.

## What's committable

The spec, the scenarios, and a guard baseline are committable so they travel with the repo; everything else is local-only:

```text theme={null}
.truecourse/
├── specs/                   ← curated corpus (committable)
│   ├── corpus.json          ← kept docs + area tags, docs-by-area, overlap flags, dropped docs
│   ├── decisions.json       ← user resolutions: conflict verdicts + manual areas + includes/excludes
│   ├── sources.json         ← registered llms.txt docs sites + their per-page fetch manifest
│   └── sources/<id>/        ← the fetched markdown pages of each site (real files)
├── scenarios/               ← the guard scenario corpus (committable)
│   ├── recipe.json          ← how to build/prepare the repo for a run
│   ├── manifest.json        ← section ↔ scenario bindings + section fingerprints
│   ├── externals.local.json ← external-account base URLs + API keys (GITIGNORED)
│   └── <area>/*.yaml        ← the scenario tests
├── guard/                   ← guard run store
│   ├── runs/                ← per-run snapshots (gitignored)
│   ├── LATEST.json          ← current run state (committable)
│   ├── history.json         ← per-run summaries (gitignored)
│   ├── evidence/<runId>/    ← per-failure transcripts (gitignored)
│   ├── setup.json           ← last guard setup record + detection snapshot (gitignored)
│   └── result.json          ← last generate summary (gitignored)
└── .cache/                  ← LLM caches (gitignored, safe to delete)
```

Like analyze, `guard/LATEST.json` is the committable baseline: commit it after merging to `main` (re-run `truecourse guard run`, commit the result), not from feature branches.

## Next steps

<CardGroup cols={2}>
  <Card title="Spec scan" icon="file-magnifying-glass" href="/guard/spec-scan">
    Start the pipeline: curate your docs into a corpus.
  </Card>

  <Card title="Guard setup" icon="screwdriver-wrench" href="/guard/setup">
    Prepare the repo: recipe, external APIs, and the data + auth seed.
  </Card>
</CardGroup>
