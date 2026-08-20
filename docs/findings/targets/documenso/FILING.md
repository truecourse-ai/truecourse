# Filing rules for documenso/documenso

**Regenerated 2026-08-20** by `tools/fetch-filing-rules.py`. Templates and label vocabularies drift, so re-run this before each batch and read the diff. The rules that apply to every target live in `../../FILING-GUIDE.md`.

## documenso/documenso

- Private vulnerability reporting: **true**  (so `gh api -X POST repos/documenso/documenso/security-advisories/reports` works)
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **false**  (every issue MUST go through a template)
- Templates: `bug-report.yml`, `config.yml`, `feature-request.yml`, `improvement.yml`

### `bug-report.yml`

- auto-labels: `['bug']`
- Body must contain these as `### ` headers, spelled exactly:

```
### Issue Description        (optional)
### Steps to Reproduce        (optional)
### Expected Behavior        (optional)
### Current Behavior        (optional)
### Screenshots (optional)        (optional)
### Operating System [e.g., Windows 10]        (optional)
### Browser [e.g., Chrome, Firefox]        (optional)
### Version [e.g., 2.13.0]        (optional)
### Please check the boxes that apply to this issue report.        (optional)
```

### `feature-request.yml`

- Body must contain these as `### ` headers, spelled exactly:

```
### Feature Description        (optional)
### Use Case        (optional)
### Proposed Solution        (optional)
### Alternatives (optional)        (optional)
### Additional Context        (optional)
### Please check the boxes that apply to this feature request.        (optional)
```

### `improvement.yml`

- auto-title: `'[Title for your improvement suggestion]'`
- Body must contain these as `### ` headers, spelled exactly:

```
### Describe the improvement you are suggesting in detail
### Additional Information & Alternatives (optional)        (optional)
### Please check the boxes that apply to this improvement suggestion.
```

- Template-enforcing workflows: none detected

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `status: triage` | 30 |

## Quirks learned by filing (hand-written, keep across regenerations)

**No template-enforcing workflow was detected**, so a malformed body is unlikely to be auto-closed the way Strapi does it. Use the template sections anyway: `blank_issues_enabled: false` means the form is the only route, and matching it keeps a triager oriented.

**Do not open pull requests.** CONTRIBUTING.md opens with "We are no longer accepting external pull requests", repeated in pinned issue 3026: most new PRs are closed with a request to open an issue instead. Issues are the contribution route. Commenting on an already-open community PR is still fine and is how three of our findings are routed.

**Caveat to that:** the policy is stated but not uniformly applied. Three external docs PRs from one recurring contributor merged on 2026-08-19.

**Every new issue gets `status: triage` automatically** (`.github/workflows/issue-opened.yml`), which is why it is the only label on all 30 recent issues. Real labels (`type: bug`, `type: documentation`, `apps: web`) are applied by hand later, so a `Suggested labels` line still helps. Note the template's own frontmatter asks for `bug` while the repo's real label is `type: bug`.

**Fill Operating System and Browser even for API findings**, with `n/a (API, self-hosted from source)` rather than leaving them blank.

**Version matters here.** Tested 2.16.0; main is now v2.17.0 and two findings were fixed in it. Say which build the reproduction ran on.

**Stale bot:** issues go stale after 90 days, but `status: triage` is exempt and every new issue carries it, so our filings will not be auto-staled unless a maintainer removes it.

**Security:** SECURITY.md excludes rate limiting and denial of service from scope, and notes they run Codex security analysis and may close a report as a duplicate of a Codex finding.
