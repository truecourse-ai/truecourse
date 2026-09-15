<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/truecourse-logo-horizontal@2x.png" />
    <img src="assets/truecourse-logo-horizontal-light@2x.png" alt="TrueCourse" width="320" />
  </picture>
</p>

<p align="center">
  <strong>Tests that prove your product does what your documentation promises.</strong>
</p>

<p align="center">
  <a href="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml"><img src="https://github.com/truecourse-ai/truecourse/actions/workflows/test.yml/badge.svg" alt="Tests" /></a>
  <a href="https://github.com/truecourse-ai/truecourse/blob/main/LICENSE"><img src="https://img.shields.io/github/license/truecourse-ai/truecourse" alt="License" /></a>
  <a href="https://discord.gg/TanxB63arz"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

TrueCourse reads the documentation a team already writes (PRDs, ADRs, READMEs,
a documentation site) and turns it into tests that run.

It curates those documents into a corpus of **claims**, works out the **flows** a
user takes through the product, writes a test for each one against the real
interfaces, and runs them. A failing test means the product and the documentation
disagree, and it names which section.

**[docs.truecourse.dev](https://docs.truecourse.dev)** has the guides: connecting
documentation and a repository, how flows and claims fit together, the drivers,
and self-hosting.

## Run it locally

```bash
docker compose up -d                    # Postgres, the whole of the storage
pnpm install
TRUECOURSE_MODE=local pnpm dev          # http://localhost:3000
```

`TRUECOURSE_MODE=local` is one machine: no sign-in, one implicit person in one
implicit workspace, and folders on this machine can be connected as repositories.
It needs `DATABASE_URL` and `TRUECOURSE_SECRET_KEY`; the compose defaults are in
`.env.example`.

## Run it on Claude Code

To run on your own Claude Code login instead of an API key:

```bash
docker compose up -d
pnpm install
TRUECOURSE_MODE=local TRUECOURSE_LLM_TRANSPORT=claude-code pnpm dev
```

This needs the `claude` binary on your PATH and signed in. Every run then uses
that login and the Models page is read-only; leave the variable out to save a
provider and key on that page instead.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the development setup, the project
structure and what makes a good pull request.

## Community

Join the [TrueCourse Discord](https://discord.gg/TanxB63arz) to ask questions,
share feedback, and follow what's shipping.

## Contact

Questions, feedback, or security reports: **Mushegh Gevorgyan**,
[mushegh@truecourse.dev](mailto:mushegh@truecourse.dev).

## License

MIT
