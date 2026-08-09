> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Quickstart

> Install TrueCourse, run your first code analysis, and guard your specs in minutes.

## Install

```bash theme={null}
npm install -g truecourse
```

This puts the `truecourse` command on your PATH. Prefer not to install globally? Run any command one-off with `npx truecourse <command>` instead. See [Installation](/installation) for prerequisites.

<Note>
  The very first `truecourse` command you run asks once how TrueCourse should reach the LLM (your existing Claude Code login, recommended and key-free, or a provider API with your own key) and saves the answer. Deterministic analysis works with neither. See [LLM transport](/configuration/llm-transport).
</Note>

## Analyze your code

<Steps>
  <Step title="Run the analysis">
    ```bash theme={null}
    cd <your-repo>
    truecourse analyze
    ```

    The first run creates `.truecourse/` in your repo and stores results there as plain JSON.
  </Step>

  <Step title="See what it found">
    ```bash theme={null}
    truecourse list
    ```

    Lists the violations from the latest analysis: severity, rule, file, and line.
  </Step>

  <Step title="Open the dashboard">
    ```bash theme={null}
    truecourse dashboard
    ```

    Browse the architecture graph, violations, and analytics visually. See [Dashboard](/dashboard).
  </Step>

  <Step title="Commit the baseline">
    ```bash theme={null}
    git add .truecourse/LATEST.json .truecourse/config.json
    git commit -m "add truecourse baseline"
    ```

    With a committed baseline, `truecourse analyze --diff` shows only what your in-flight changes introduce, and the optional [pre-commit hook](/analyze/git-hooks) can block new violations. See [Baselines & diff](/analyze/baseline-and-diff).
  </Step>
</Steps>

## Guard your specs

The spec → guard track turns your docs into executable checks. It needs an LLM for `spec scan`, `guard setup`, and `guard generate` (not for `guard run`), and a **git repository**, because baselines are commit-anchored.

<Steps>
  <Step title="Curate your docs into a corpus">
    ```bash theme={null}
    truecourse spec scan
    ```

    Walks every markdown and OpenAPI file in the repo, drops non-spec material, tags each kept doc into areas, and flags within-area overlaps where two docs may disagree. See [Spec scan](/guard/spec-scan).
  </Step>

  <Step title="Review flagged conflicts">
    ```bash theme={null}
    truecourse spec conflicts list
    ```

    Resolve genuine disagreements between docs with `truecourse spec conflicts resolve`: pick a side or dismiss. See [Resolving conflicts](/guard/conflicts).
  </Step>

  <Step title="Prepare the repo">
    ```bash theme={null}
    truecourse guard setup
    ```

    The cheap preparation stage (at most two LLM calls): derives and proves the build recipe, declares the external APIs your app calls, and drafts the data + auth seed. A prerequisite for generate. See [Guard setup](/guard/setup).
  </Step>

  <Step title="Author scenario tests">
    ```bash theme={null}
    truecourse guard generate
    ```

    An LLM splits each doc into sections, classifies what's testable, authors declarative YAML scenarios bound to each section, and birth-validates each one by running it immediately. See [Guard generate](/guard/generate).
  </Step>

  <Step title="Run the scenarios">
    ```bash theme={null}
    truecourse guard run
    ```

    Fully deterministic: builds the repo via the recipe and executes every committed scenario. Exits non-zero on any drift, so it drops straight into CI. See [Guard run](/guard/run).
  </Step>
</Steps>

## Next steps

<CardGroup cols={2}>
  <Card title="What analyze catches" icon="magnifying-glass-chart" href="/analyze/overview">
    The 8 rule categories, deterministic vs LLM rules, and language support.
  </Card>

  <Card title="How guard works" icon="shield-check" href="/guard/overview">
    The four-stage pipeline: spec consolidation → setup → scenario generation → deterministic runs.
  </Card>

  <Card title="Git hooks" icon="code-branch" href="/analyze/git-hooks">
    Block commits that introduce new violations.
  </Card>

  <Card title="LLM transport" icon="plug" href="/configuration/llm-transport">
    Claude Code, a provider API, or an agent mailbox.
  </Card>
</CardGroup>
