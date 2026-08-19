# Documenso filing policy (read 2026-08-19, at origin/main = 75330166cc = tag v2.17.0)

Everything below was read from `documenso/documenso` at today's head. Docs (`apps/docs/`) live in this same repo, so there is no separate docs repo and no separate docs tracker.

## Headline: external pull requests are no longer accepted

`CONTRIBUTING.md` (https://github.com/documenso/documenso/blob/main/CONTRIBUTING.md), first line:

> **We are no longer accepting external pull requests.**
>
> Aside from a small group of trusted contributors we reach out to directly, we no longer merge external PRs. New pull requests will usually be closed with a request to open an issue instead. This is a security decision, not a judgement on your work.

> ## How to contribute now
> The most useful contribution is a detailed issue. Treat it like a spec. The more detail, the better:
> - The problem you're trying to solve, and who it affects
> - How you expect the feature or change to behave
> - Edge cases, constraints, and anything you've already considered
> - Examples, mockups, or references where they help

> Before opening an issue, search [existing issues](https://github.com/documenso/documenso/issues) and [discussions](https://github.com/documenso/documenso/discussions) for related items.

The same text is pinned as issue **#3026, "Please read before contributing: We're pausing external pull requests"** (open, created 2026-06-25, last updated 2026-08-19): https://github.com/documenso/documenso/issues/3026. It adds:

> - External pull requests will no longer be merged, aside from a small group of trusted contributors we'll reach out to directly.
> - Most new PRs will be closed with a request to open an issue instead.
> - Existing PRs may still be merged as normal. Work already in flight isn't affected.
> - Issues are now the primary way to contribute.

`.github/PULL_REQUEST_TEMPLATE.md` repeats it in an HTML comment at the top and points at `issues/new/choose`.

**Filing consequence:** every one of these findings should be filed as an ISSUE, not a PR, unless it is a security report. "Existing PRs may still be merged as normal" is why commenting on an already-open community PR (for example #3136) is still a live option; opening a NEW PR is not.

Caveat worth knowing: the policy is stated but not uniformly applied. Between 2026-08-13 and 2026-08-19 dozens of external PRs were opened and three external docs PRs (#3133, #3134, #3135, all by ephraimduncan) were merged on 2026-08-19. So external PRs are still landing in practice from at least one recurring contributor.

## Security policy

`SECURITY.md` (https://github.com/documenso/documenso/blob/main/SECURITY.md). Operative sentences:

> Report security vulnerabilities privately. Do not open a public issue, discussion, or pull request for security reports.

> 1. **GitHub Security Advisories (preferred)**. Use the [private vulnerability reporting form](https://github.com/documenso/documenso/security/advisories/new). This is our primary channel and lets us triage and work with you on a fix.
> 2. **Email**. If you cannot use GitHub Security Advisories, email [security@documenso.com](mailto:security@documenso.com).

> Include the affected version, a clear description, steps to reproduce, and the potential impact.

Triage note that matters for dedupe:

> We also run [Codex](https://openai.com/codex/) security analysis across the codebase. If Codex has already reported the issue you're sending us, we may close your report as a duplicate.

### Scope exclusions (verbatim list)

> This policy covers vulnerabilities in the Documenso application code in this repository.
>
> The items below are out of scope and will not be accepted. They are deployment, infrastructure, and configuration concerns that belong with the operator's firewall, network, and environment setup, not the application:
>
> - Server-Side Request Forgery (SSRF) and related network-egress concerns
> - DNS rebinding and other DNS-level issues
> - **Rate limiting, denial of service, and volumetric attacks**
> - TLS and certificate configuration, HTTP security headers, and other reverse-proxy or web-server configuration
> - Findings that depend on insecure self-hosted infrastructure or misconfiguration
>
> If you're unsure whether something is in scope, report it privately anyway and we'll happily take a look.

> ## Supported Versions
> Security fixes are applied to the latest release. Run the most recent version of Documenso.

**Filing consequences:**
- D6 (rate-limit value) is squarely inside the "Rate limiting, denial of service, and volumetric attacks" exclusion, so it is never a security disclosure. It is a docs-vs-release accuracy matter, and it is now fixed anyway.
- D1 (a sent PENDING document accepts new recipients / recipient edits / deletes / field writes) is application-code authorization-and-integrity behavior on a first-party API surface. It is in scope. It is however an authenticated same-team API-token holder acting on their own team's document, so it reads as a missing business-rule guard rather than a cross-tenant privilege escalation. Two ways to see it: SECURITY.md's "If you're unsure whether something is in scope, report it privately anyway and we'll happily take a look" argues for the advisory form; the fact that the repo already carries public issues for closely comparable integrity bugs (#3188 "setDocumentRecipients and setFieldsForDocument delete already-signed recipients and fields", #3189 "Adding a recipient through API v1 recreates all the others", #2475 "Validation bypass allows creating Ghost Recipients") argues the maintainers treat this class publicly. Note also that a real security submission has been filed publicly and left open (#2758, "Bug Bounty report: 2FA Bypass via Google OAuth Login"), which shows public security filings are tolerated but is not what the policy asks for.

## Issue templates

`gh api repos/documenso/documenso/contents/.github/ISSUE_TEMPLATE` returns four files: `bug-report.yml`, `feature-request.yml`, `improvement.yml`, `config.yml`.

`config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/documenso/documenso/security/advisories/new
    about: Please report security vulnerabilities privately via GitHub Security Advisories. Do not open a public issue.
  - name: Questions & Discussions
    url: https://github.com/documenso/documenso/discussions
  - name: Discord
    url: https://documen.so/discord
```

Blank issues are DISABLED. Every issue must go through one of the three templates.

### `bug-report.yml` (the one to use for all ten defects)

Frontmatter: `name: 'Bug Report'`, `labels: ['bug']`, no `title:` prefix. Required sections, in order (none of them carry `validations: required`, so all are technically optional, but the form renders them all):

1. **Issue Description** - "a clear and concise description of the problem"
2. **Steps to Reproduce** - "step-by-step instructions to reproduce the issue. Include code snippets, error messages, and any other relevant information"
3. **Expected Behavior**
4. **Current Behavior**
5. **Screenshots (optional)**
6. **Operating System** (single-line input, e.g. "Windows 10")
7. **Browser** (single-line input, e.g. "Chrome, Firefox")
8. **Version** (single-line input, e.g. "2.13.0")
9. Checkboxes: searched existing issues for a duplicate / provided steps to reproduce / included environment information / included screenshots / "I understand that this is a voluntary contribution and that there is no guarantee of resolution"

Filing notes: the **Version** field is mandatory in spirit and we have a precise answer (tested v2.16.0, re-checked against v2.17.0 = today's main). The **Browser** and **Operating System** fields are meaningless for the API findings (D1-D6); leave them as "n/a (API, self-hosted from source)" rather than blank. For the web findings (D7, D8, D9) fill them from the guard run's browser.

Note a small inconsistency to expect: the template's frontmatter asks for the label `bug`, but the repo's actual label is `type: bug`. GitHub will create the bare `bug` label or drop it; the maintainers relabel by hand.

### `feature-request.yml` and `improvement.yml`

`improvement.yml` has `title: '[Title for your improvement suggestion]'` as a placeholder prefix and requires "Describe the improvement you are suggesting in detail" plus a checkbox block. `feature-request.yml` asks for Feature Description / Use Case / Proposed Solution / Alternatives / Additional Context. Neither fits a defect report; use `bug-report.yml` for all ten.

## Labels and what happens after filing

`.github/workflows/issue-opened.yml` adds `status: triage` to every newly opened or reopened issue automatically. No other automation runs on open.

Relevant labels in the repo (maintainer-applied, not selectable from the template):

- `type: bug` - "Something isn't working"
- `type: documentation` - "Improvements or additions to documentation"
- `type: enhancement`, `type: feature`
- `apps: web` - "Issues related to the webapp"
- `status: triage`, `status: assigned`, `status: backlogged`, `status: blocked`, `status: review needed`, `status: wontfix`
- `community: replication-wanted`, `community: implementation-wanted`, `community: testing-wanted`
- `duplicate`, `good first issue`, `Stale`
- Algora bounty labels: `💎 Bounty`, `🙋 Bounty claim`, `💰 Rewarded`

**There is no docs-specific issue template and no docs-specific tracker.** `apps/docs/` is part of this repo, so a documentation defect is filed with the same `bug-report.yml` form; the only docs-specific handle is the maintainer-applied `type: documentation` label. Mention "documentation" and the exact `apps/docs/content/docs/...` path in the title and body so a triager can apply it.

`.github/workflows/stale.yml`: issues and PRs go stale after 90 days of inactivity and close 180 days after that. `status: triage`, `status: assigned`, `roadmap`, `WIP`, `on-hold` and `needs review` are exempt, and since every new issue gets `status: triage` on open, our filings will not be auto-staled unless a maintainer removes that label.

## Other repo conventions worth honoring

- `CONTRIBUTING.md`: "Please write all issues, pull requests, and related comments in English."
- `CONTRIBUTING.md`, taking an issue: only take one that "has been assigned the public label", is clearly defined, is unassigned, and that nobody has claimed. Not relevant to filing, relevant if we ever offer to implement.
- `CODE_OF_CONDUCT.md`, `CLA.md`, `CODE_STYLE.md`, `WRITING_STYLE.md`, `ARCHITECTURE.md` all exist at the repo root. `CLA.md` matters only if we ever submit code.
- `community/profile` reports 100% health but lists no `security_policy` file entry even though `SECURITY.md` exists at the root; do not read that absence as "no policy".

## Recommended routing for the whole Documenso batch

Defect findings D1 to D9 are mine; the doc findings D10 to D17 were routed by the doc-bug agent and are reproduced here so the filer has one table.

| Route | Findings | Basis |
|---|---|---|
| Public issue via `bug-report.yml` | D2b, D3, D4, D5, D7, D8, D9, D10, D15, D16 | CONTRIBUTING.md: "Issues are now the primary way to contribute." None touch SECURITY.md's scope. |
| Security disclosure via https://github.com/documenso/documenso/security/advisories/new | D1 | SECURITY.md: "Report security vulnerabilities privately. Do not open a public issue, discussion, or pull request for security reports," combined with "If you're unsure whether something is in scope, report it privately anyway." |
| Comment on an existing open PR | D2a, D11, D12 on #3136; D14 on #3137 | "Existing PRs may still be merged as normal. Work already in flight isn't affected." #3136 is open and, since 2026-08-19, rebased onto `main`, so it can now land on its own; it fixes only the coordinate half, so D2b still needs its own issue. |
| Skip, already fixed | D6, D13 | Both landed in v2.17.0 on 2026-08-19: D6 by PR #3081, D13 by PR #3135. |
| Skip, not a finding | D17 | Test defect. |

Do NOT open a pull request for any of these.
