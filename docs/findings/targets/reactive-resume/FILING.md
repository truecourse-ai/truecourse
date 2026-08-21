# Filing rules for AmruthPillai/Reactive-Resume

**Regenerated 2026-08-20** by `tools/fetch-filing-rules.py`. Templates and label vocabularies drift, so re-run this before each batch and read the diff. The rules that apply to every target live in `../../FILING-GUIDE.md`.

## AmruthPillai/Reactive-Resume

- Private vulnerability reporting: **true**  (so `gh api -X POST repos/AmruthPillai/Reactive-Resume/security-advisories/reports` works)
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **false**  (every issue MUST go through a template)
- Templates: `1-bug-report.yml`, `2-feature-request.yml`, `config.yml`

### `1-bug-report.yml`

- auto-labels: `["bug", "status: needs triage"]`
- Body must contain these as `### ` headers, spelled exactly:

```
### Existing issue
### Product variant
### Reactive Resume version
### Area
### Environment
### Summary
### Steps to reproduce
### Expected behavior
### Actual behavior
### Template        (optional)
### Logs and screenshots        (optional)
```

### `2-feature-request.yml`

- auto-labels: `["enhancement", "status: needs triage"]`
- Body must contain these as `### ` headers, spelled exactly:

```
### Existing issue
### Product variant
### Area
### Problem
### Desired outcome
### Alternatives considered
### Proposed scope
### Additional context        (optional)
```

- Template-enforcing workflows: none detected

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `bug` | 24 |
| `status: needs triage` | 20 |
| `deployment: cloud` | 19 |
| `v5` | 14 |
| `area: rendering` | 10 |
| `area: builder` | 8 |
| `status: confirmed` | 6 |
| `enhancement` | 5 |
| `needs triage` | 5 |
| `deployment: self-hosted` | 3 |
| `area: account` | 2 |
| `help wanted` | 1 |
| `good first issue` | 1 |
| `area: self-hosting` | 1 |
| `area: localization` | 1 |
| `status: needs info` | 1 |
| `area: integrations` | 1 |
| `area: applications` | 1 |
