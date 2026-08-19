# Strapi filing policy (read 2026-08-19)

Covers `strapi/strapi` (the product) and `strapi/documentation` (the user docs, a separate repo).
Everything below was fetched from the GitHub contents API on 2026-08-19; quotes are verbatim.

---

## 1. strapi/strapi

Community profile: `code_of_conduct`, `contributing`, `pull_request_template` and `readme` present;
`issue_template` reports `null` because the repo uses the newer `.github/ISSUE_TEMPLATE/` directory
form rather than a single legacy file. A `SECURITY.md` exists at the repo root.

### 1.1 Security policy

Source: https://github.com/strapi/strapi/blob/develop/SECURITY.md

**Intake channel: GitHub Security Advisories only.**

> **All vulnerability reports are REQUIRED to be submitted through GitHub's Security Advisory (GHSA) system.** This is the only accepted intake channel for security reports.

Submission link: https://github.com/strapi/strapi/security/advisories/new

> Strapi does not support other reporting platforms

Explicitly unsupported: huntr.dev, "Direct email or communication to Strapi employees (Discord, Slack, or Email)",
Stack Overflow. There is one narrow exception:

> **Narrow exception:** If GitHub is blocked or restricted in your jurisdiction and you are genuinely unable to access the GHSA submission flow, you may email `security@strapi.io` and we will open a GHSA on your behalf.

**No bounty.**

> **Strapi does not currently and has no plans to offer any bug bounties, swag, or any other reward for reporting vulnerabilities.**

**Supported versions.** v5.x GA/STABLE only, as of May 2026. v4.x is End Of Life (security updates ended April 2026).
Anything filed must reproduce on a current v5 GA release.

**Scope.** In scope: "Latest GA / Stable releases of v5.x.x" and "Vulnerabilities in `@strapi/*` packages published from this repository".
Out of scope: EOL majors and non-GA v5 tags, third-party/marketplace plugins, customer-operated instances,
Strapi Cloud tenants you do not operate, forks.

**Testing requirement (the sentence most likely to bite an MCP or error-message finding).**

> Reporters are expected to validate findings against a **properly configured production application** before submitting a report.

and, in the list of things that must NOT be reported:

> - Verbose error responses, stack traces, or debug output that only appear in development mode
> - Any behavior that reproduces under `strapi develop` but does not reproduce under `strapi start` with a hardened production configuration
>
> If a report only reproduces in development mode or with default development configuration, it will be closed as out of scope.

Note for the MCP findings: the MCP server is gated by `server.mcp.enabled` (default `false`), NOT by dev mode.
`McpConfiguration.isEnabled()` reads `server.mcp.enabled`; `isDevMode()` (which reads `autoReload`) only widens
which capabilities a session may use. So an MCP defect does reproduce under `strapi start` when the operator
opts in, and the dev-mode exclusion does not automatically apply. A filer should say so explicitly.

**Other exclusions relevant to a disclosure-shaped finding.**

> - **Banner, version, or stack disclosure** on public surfaces without a demonstrated downstream exploit
> - **Theoretical vulnerabilities** described in prose but lacking a working, reproducible Proof of Concept
> - 4.1.2 Conditions or behaviors that do not lead to a security impact SHOULD NOT be determined to be Vulnerabilities.

**Required report contents** (all mandatory): summary; detailed description of what the vulnerability does and
what it has access to; Proof of Concept (code samples at minimum) that shows

> how the vulnerability can actually access sensitive data, escalate privileges, or otherwise violate a security boundary

impact summary; and an AI-usage disclosure. English only. A required markdown template is given in the policy
(Summary / Affected Versions / Vulnerability Details / Proof of Concept / Impact / Suggested CVSS 4.0 / AI Usage Disclosure).

**AI disclosure is mandatory and load-bearing for anything found with agentic tooling.**

> If artificial intelligence tools (LLMs, AI-powered scanners, AI-assisted code analysis, agentic coding tools, etc.) were used in **any** part of discovering, validating, analyzing, or drafting your vulnerability report, you are **required** to disclose this in your initial report.

The disclosure must list the tools, the stages they were used in, and confirm human verification.

> Reports that appear to be AI-generated without human validation, or that fail to disclose AI use when it was clearly involved, are likely to be rejected.

**No file attachments** on the initial report; inline everything in fenced code blocks.

**No response SLA.** "We can no longer commit to a specific response timeframe." Escalation path: wait 14 days,
then comment on the GHSA thread; only after a further 14 days may you email `security@strapi.io` citing the GHSA ID.

**Credit is opt-in**, stated in the report (credit with name/handle/URL, anonymous credit, or no credit; default is no credit).

**Safe harbour** applies to good-faith research reported exclusively through GHSA and tested only against
installations you own or operate.

### 1.2 Contributing / bug intake

Source: https://github.com/strapi/strapi/blob/develop/CONTRIBUTING.md

> ## Bugs
>
> Strapi is using [GitHub issues](https://github.com/strapi/strapi/issues) to manage bugs. We keep a close eye on them. Before filing a new issue, try to ensure your problem does not already exist.

So a non-security defect goes to a public issue on `strapi/strapi`. There is no discussion-first rule for bug
reports (the discussion-first advice is aimed at pull requests):

> We highly appreciate your effort to contribute, but we recommend you talk to a maintainer before spending a lot of time making a pull request that may not align with the project roadmap.

Feature requests do NOT go to issues:

> Feature Requests by the community are highly encouraged. Feel free to submit a new one or upvote an existing feature request on [feedback.strapi.io](https://feedback.strapi.io/).

Large changes go through https://github.com/strapi/rfcs.

Docs are routed away from this repo:

> Pull requests related to fixing documentation for the latest release should be directed towards the [documentation repository](https://github.com/strapi/documentation).

PR prerequisites, if a filer also opens a fix: fork and branch from `develop`; Node >= v22 and <= v26 with Yarn 1.2+;
`yarn install` + `yarn setup`; add tests for a fixed bug; `yarn test:unit`, `yarn test:front`,
`yarn test:e2e --setup --concurrency=1` must pass; `yarn lint`; link the issue the PR fixes. A CLA is required
(https://cla.strapi.io/strapi/strapi), signed once, and the CLA bot asks automatically.

### 1.3 Issue templates

`gh api repos/strapi/strapi/contents/.github/ISSUE_TEMPLATE` returns exactly two files:

- `BUG_REPORT.yml` (name "🐛 Bug Report", no forced `title:` prefix, no auto `labels:`)
- `config.yml`

**`config.yml` sets `blank_issues_enabled: false`** - every issue must go through the bug-report form or one of the
contact links. The contact links route elsewhere: product feature requests to feedback.strapi.io, **documentation
bug reports to `strapi/documentation`'s `BUG_REPORT.yml` with label `type: bug` and title prefix `[Bug]: `**,
documentation requests to `strapi/documentation`'s `DOC_REQUEST.yml`, plus the plugin SDK, JS/TS SDK and design-system
repos, and the community Discord.

`BUG_REPORT.yml` **required** fields (a filer must have all of these ready):

| Field | Type | Note |
|---|---|---|
| Node Version | input | "only LTS versions are supported" |
| Package Manager | dropdown | npm / yarn / pnpm / bun / Other |
| Package Manager Version | input | |
| Strapi Version | input | **"Latest" is not a valid response** - give e.g. `5.52.0` |
| Operating System | dropdown | Strapi Cloud / MacOS / Linux (Debian-Ubuntu, RedHat-CentOS, Other) / Windows 10 / Windows 11 / Docker-Podman-LXC / Other |
| Database | dropdown | Strapi Cloud / SQLite / MySQL / MariaDB / PostgreSQL / Other |
| Javascript or Typescript | dropdown | |
| Bug Description | textarea | |
| Steps to Reproduce | textarea | step-by-step, code snippets or repo links |
| Expected Behavior | textarea | "Provide a detailed explanation of what you expected to happen instead" |
| Confirmation checklist | checkboxes | both boxes required: duplicate check, and Code of Conduct |

Optional: Reproduction URL (a repro repository is **encouraged but not required**), Logs (rendered as shell),
Code Snippets, Media, Additional information.

There is no "Actual Behavior" field: the observed behavior belongs in Bug Description. The template asks for
Expected Behavior separately, so a report should state the documented expectation there and the observed wire
behavior in the description.

---

## 2. strapi/documentation (the user docs repo)

Repo: https://github.com/strapi/documentation - publishes https://docs.strapi.io.

### 2.1 Security

`SECURITY.md` exists but is an older copy of the product policy and points back at the product repo's advisory form:

> Please report (suspected) security vulnerabilities via GitHub's security advisory reporting system:
> Submit your vulnerability via [this link](https://github.com/strapi/strapi/security/advisories/new)

It still names v4.x as supported and asks for CVSS 3.1 and a 72-hour response ("You will receive a response from us
within 72 hours"), both of which the product repo's newer policy supersedes. Treat `strapi/strapi`'s SECURITY.md as
authoritative; nothing security-shaped should be filed in the docs repo.

### 2.2 Issue templates

`.github/ISSUE_TEMPLATE/` contains `BUG_REPORT.yml`, `DOC_REQUEST.yml`, `config.yml`.

`config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Strapi Project Issues
    url: https://github.com/strapi/strapi/issues
    about: Please use the strapi/strapi repo for these issues.
```

So blank issues are disabled here too, and product bugs are pushed back to `strapi/strapi`. A doc bug must go
through the form.

`BUG_REPORT.yml` - name "Documentation Bug Report", **auto-title `[Bug]: `**, **auto-label `type: bug`**:

| Field | Required | Note |
|---|---|---|
| Link to the documentation page or resource | yes | a docs.strapi.io URL |
| Describe the bug | yes | |
| Additional context | no | |
| Suggested improvements or fixes | no | "A clear and concise description of what you want to happen" |
| Related issue(s)/PR(s) | no | |

`DOC_REQUEST.yml` - name "Documentation Request", auto-title `[Request]: `, auto-label `type: doc request`,
required "Summary". Use this only for missing documentation, not for a wrong sentence.

### 2.3 Contributing

Source: https://github.com/strapi/documentation/blob/main/CONTRIBUTING.md

Scope of the repo:

> The Strapi Documentation team does not maintain blog articles hosted at [strapi.io/blog](https://strapi.io/blog) or any other educational or informational content not hosted on the [official documentation website](docs.strapi.io); these should not be subject to GitHub pull requests or issues on the present repository.

Maintainer-first advice for larger work (this is the discussion-first rule, and it is advisory, not a gate):

> we recommend you talk to a maintainer (`@pwizla` or `@meganelacheny`) prior to investing a lot of time in a pull request that may not align with the project roadmap

English only:

> Please note that contributions, pull requests, and issues should be written in English.

Two accepted PR routes:

> - forking the `documentation` repository and working locally,
> - or, for smaller updates, clicking the `Improve this page` link at the bottom of any documentation page to directly edit in GitHub.

The "Improve this page" route is the cheapest path for a one-sentence doc correction.

Branch naming is enforced by section: CMS pages live in `/docusaurus/docs/cms/` and the branch must be prefixed
`cms/`; Cloud pages in `/docusaurus/docs/cloud/` with prefix `cloud/`; cross-cutting changes use `repo/`.
PRs target `main` by default.

Hard prerequisite before opening a docs PR:

> **Important prerequisite: Build the content locally before submitting a pull request**
> ... before submitting your pull request, please stop the development server and build the page locally: ... run `yarn build`.

Also:

> **Important: Please disable any linter or automatic formatting tool(s)** before saving and submitting your files.

Contributions are auto-labelled `contribution` and enter the Docs Contribution Program (points redeemable in the
Strapi shop); a contributor may ask for the label to be removed to opt out.

---

## 3. Practical routing rules that follow

1. A product defect on a current v5 GA release, not security-shaped: public issue on `strapi/strapi` via
   `BUG_REPORT.yml`. Blank issues are disabled, so the form's required fields (Node, package manager + version,
   exact Strapi version, OS, database, JS/TS, description, steps, expected) must all be filled.
2. Anything with a security boundary: GHSA only, at https://github.com/strapi/strapi/security/advisories/new,
   with the required template and an explicit AI-usage disclosure. Never a public issue, never email.
3. A wrong sentence on docs.strapi.io: issue on `strapi/documentation` via its `BUG_REPORT.yml` (auto-titled
   `[Bug]: `, auto-labelled `type: bug`), or directly a PR from the page's "Improve this page" link. Do not file
   doc bugs on `strapi/strapi` - its `config.yml` deliberately redirects them.
4. A feature or behaviour change request: feedback.strapi.io, not an issue.
5. Anything only reproducible under `strapi develop` will be closed; state the production configuration used.
