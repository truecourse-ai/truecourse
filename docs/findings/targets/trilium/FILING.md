# Filing rules for TriliumNext/Trilium

**Regenerated 2026-08-20** by `tools/fetch-filing-rules.py`. Templates and label vocabularies drift, so re-run this before each batch and read the diff. The rules that apply to every target live in `../../FILING-GUIDE.md`.

## TriliumNext/Trilium

- Private vulnerability reporting: **true**  (so `gh api -X POST repos/TriliumNext/Trilium/security-advisories/reports` works)
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **unknown**
- Templates: `bug_report.yml`, `feature_request.yml`, `task.yml`

### `bug_report.yml`

- Body must contain these as `### ` headers, spelled exactly:

```
### Description
### TriliumNext Version
### What operating system are you using?
### What is your setup?
### Operating System Version
### Error logs        (optional)
```

### `feature_request.yml`

- Body must contain these as `### ` headers, spelled exactly:

```
### Describe feature
### Additional Information        (optional)
```

### `task.yml`

- Body must contain these as `### ` headers, spelled exactly:

```
### Describe Task
```

- Template-enforcing workflows: none detected

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `State: Triage` | 22 |
| `UI` | 17 |
| `BE` | 6 |
| `awaiting feedback` | 3 |
| `mobile` | 3 |
| `llm` | 2 |
| `ckeditor` | 2 |
| `container` | 2 |
| `Difficulty: Easy` | 2 |
| `desktop-app` | 2 |
| `downstream` | 1 |
| `sync` | 1 |
| `regression` | 1 |
| `Type: Scripts & Themes` | 1 |
