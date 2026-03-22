# Contributing to TrueCourse

Thanks for your interest in contributing to TrueCourse! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/truecourse.git
   cd truecourse
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Copy the environment file:
   ```bash
   cp .env.example .env
   # Edit .env with your ANTHROPIC_API_KEY or OPENAI_API_KEY
   ```
5. Start the dev server:
   ```bash
   pnpm dev
   ```

## Finding Issues to Work On

Look for issues tagged with [`good first issue`](https://github.com/truecourse-ai/truecourse/labels/good%20first%20issue) — these are scoped, well-documented tasks suitable for new contributors.

Other helpful labels:
- `help wanted` — issues where we'd appreciate community contributions
- `bug` — confirmed bugs ready to be fixed
- `enhancement` — feature requests that have been accepted

## Development Workflow

1. Create a branch from `main`:
   ```bash
   git checkout -b your-feature-name
   ```
2. Make your changes
3. Run tests:
   ```bash
   pnpm test
   ```
4. Commit with a clear message describing the change
5. Push to your fork and open a pull request

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new functionality
- Make sure existing tests pass
- Update documentation if your change affects user-facing behavior

## Project Structure

```
apps/
  web/          # Next.js web UI
  cli/          # CLI entry point
packages/
  core/         # Analysis engine, rules, database
  shared/       # Shared types and utilities
```

## Code Style

- TypeScript throughout
- The project uses ESLint and Prettier — run `pnpm lint` to check
- Prefer explicit types over `any`
- Write tests for new rules and analysis logic

## Adding a New Language

See [ADDING_A_LANGUAGE.md](./ADDING_A_LANGUAGE.md) for the guide on adding support for a new programming language.

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Any relevant error output

## Questions?

Open a [Discussion](https://github.com/truecourse-ai/truecourse/discussions) for questions, ideas, or general conversation about the project.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
