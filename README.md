<p align="center">
  <img src="assets/logo.svg" alt="TrueCourse" width="300" />
</p>

<p align="center">
  <strong>AI Architecture & Code Intelligence Platform</strong>
</p>

<p align="center">
  <em>1,500+ deterministic rules, 100 LLM rules. JavaScript, TypeScript, Python, C#.</em>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://www.npmjs.com/package/truecourse"><img src="https://img.shields.io/npm/v/truecourse" alt="npm version" /></a>
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
  <a href="https://discord.gg/TanxB63arz"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="https://docs.truecourse.dev"><strong>📖 Documentation</strong></a> ·
  <a href="https://docs.truecourse.dev/quickstart">Quickstart</a> ·
  <a href="https://docs.truecourse.dev/reference/cli">CLI Reference</a> ·
  <a href="https://discord.gg/TanxB63arz">Discord</a>
</p>

TrueCourse catches two classes of defect, through two independent tools. Use either on its own or both together:

- **Code defects** (`truecourse analyze`): from the categories linters cover (unused code, style, missing types) through to ones they don't reach: circular dependencies, layer violations, dead modules, race conditions, security anti-patterns, performance footguns. Tree-sitter analysis combined with LLM review.
- **Business-logic drift** (`truecourse guard`): when the implementation no longer matches what the docs say it should do. TrueCourse curates your PRDs/ADRs/READMEs/OpenAPI specs into a spec corpus, an LLM authors **scenario tests bound to each spec section** once, and `guard run` executes them deterministically against your CLI or HTTP API. A failing scenario means that section and the code disagree.

Both store their results as plain JSON under `.truecourse/` in your repo (no setup step, no database) and surface them in a shared dashboard for human review, with plain-text CLI output an agent can read directly.

<p align="center">
  <img src="assets/demo.gif" alt="TrueCourse Screenshot" width="100%" />
</p>

## Install

```bash
npm install -g truecourse
```

Requires Node.js >= 20. For LLM-powered work TrueCourse uses the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) by default, or a provider API with your own key (Anthropic, OpenAI, AWS Bedrock, GitHub Copilot); your first `truecourse` command asks which. With neither available, deterministic analysis still runs. Analyzing C# additionally needs the [.NET 8 SDK](https://dotnet.microsoft.com/download). See [Installation](https://docs.truecourse.dev/installation).

## Quick start

**Analyze your code:**

```bash
cd <your-repo>
truecourse analyze          # Full analysis → .truecourse/ (plain JSON)
truecourse list             # Show the violations it found
truecourse dashboard        # Browse them visually
```

Commit `.truecourse/LATEST.json` on `main` and `truecourse analyze --diff` (and the optional [pre-commit hook](https://docs.truecourse.dev/analyze/git-hooks)) will show only what your changes introduce.

**Guard your specs** (needs an LLM for the first three steps; `guard run` is deterministic):

```bash
truecourse spec scan          # Curate your docs (markdown + OpenAPI) into a spec corpus
truecourse guard setup        # Prepare the repo: recipe + external APIs + the data/auth seed (cheap)
truecourse guard generate     # Author scenario tests bound to each spec section
truecourse guard run          # Run them deterministically; non-zero exit on drift (CI gate)
```

The full documentation lives at **[docs.truecourse.dev](https://docs.truecourse.dev)**: rule coverage, baselines and diffs, the spec → guard pipeline, the dashboard, LLM transports and per-stage models, storage layout, and the complete CLI reference.

## Development

```bash
git clone https://github.com/truecourse-ai/truecourse.git
cd truecourse
pnpm install
pnpm build              # Build all packages (required before the first `pnpm test`)
dotnet build -c Release tools/csharp-roslyn-host   # One-time, needs the .NET 8 SDK
pnpm dev                # Start dashboard at http://localhost:3000 (server on :3001)
pnpm test               # Run tests
```

`pnpm dev` expects a `.truecourse/` folder at the repo root, created automatically on the first `truecourse analyze` against the repo (or simply `mkdir -p .truecourse`).

The full test suite requires the C# Roslyn host to be built: the C# e2e test fails without it, and the Roslyn semantic-rule tests silently skip. CI builds it before running tests; do the same locally, once per checkout/worktree.

## Community

Join the [TrueCourse Discord](https://discord.gg/TanxB63arz) to ask questions, share feedback, and follow what's shipping.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan**, [mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

MIT
