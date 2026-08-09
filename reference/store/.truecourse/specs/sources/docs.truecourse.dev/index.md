> ## Documentation Index
> Fetch the complete documentation index at: https://docs.truecourse.dev/llms.txt
> Use this file to discover all available pages before exploring further.

# Introduction

> TrueCourse catches code defects and business-logic drift: two independent tools over one local, file-based store.

TrueCourse is an AI architecture and code intelligence platform. It catches two classes of defect, through two independent tools. Use either on its own or both together:

<CardGroup cols={2}>
  <Card title="Code defects: truecourse analyze" icon="magnifying-glass-chart" href="/analyze/overview">
    From the categories linters cover (unused code, style, missing types) through to ones they don't reach: circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, performance footguns. Tree-sitter analysis combined with LLM review: 1,500+ deterministic rules and 100 LLM rules across JavaScript, TypeScript, Python, and C#.
  </Card>

  <Card title="Business-logic drift: truecourse guard" icon="shield-check" href="/guard/overview">
    Catches the implementation no longer matching what the docs say it should do. TrueCourse curates your PRDs, ADRs, and READMEs into a spec corpus, an LLM authors scenario tests bound to each spec section once, and `guard run` executes them deterministically. A failing scenario means that section and the code disagree.
  </Card>
</CardGroup>

Both store their results under `.truecourse/` in your repo and surface them in a shared [dashboard](/dashboard) for human review, with plain-text CLI output an agent can read directly.

![TrueCourse dashboard](https://raw.githubusercontent.com/truecourse-ai/truecourse/main/assets/demo.gif)

## No setup, no database

TrueCourse creates `.truecourse/` in your repo on first use and stores everything there as plain JSON files; there is nothing to provision. For LLM-powered work it uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) by default, or a provider API with your own key (Anthropic, OpenAI, AWS Bedrock, GitHub Copilot). Your first `truecourse` command asks which, and [`truecourse config llm setup`](/configuration/llm-transport) changes it later. With neither available, deterministic analysis still runs and LLM-dependent features are skipped.

## Get started

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    Install TrueCourse and run your first analysis and guard cycle in minutes.
  </Card>

  <Card title="Installation" icon="download" href="/installation">
    Prerequisites, the npm package, and the first-run LLM choice.
  </Card>

  <Card title="Dashboard" icon="browser" href="/dashboard">
    One web UI for both capabilities: the architecture graph, violations, analytics, and the spec-curation + guard workflow.
  </Card>

  <Card title="CLI reference" icon="terminal" href="/reference/cli">
    Every command and flag in one place.
  </Card>
</CardGroup>

## Community

Join the [TrueCourse Discord](https://discord.gg/TanxB63arz) to ask questions, share feedback, and follow what's shipping. Questions, feedback, or security reports: [mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).
