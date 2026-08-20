# Filing rules for strapi/strapi and strapi/documentation

**Regenerated 2026-08-20** by `tools/fetch-filing-rules.py`. Templates and label vocabularies drift, so re-run this before each batch and read the diff. The rules that apply to every target live in `../../FILING-GUIDE.md`.

## strapi/strapi

- Private vulnerability reporting: **true**  (so `gh api -X POST repos/strapi/strapi/security-advisories/reports` works)
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **false**  (every issue MUST go through a template)
- Templates: `BUG_REPORT.yml`, `config.yml`

### `BUG_REPORT.yml`

- Body must contain these as `### ` headers, spelled exactly:

```
### Node Version
### Package Manager
### Package Manager Version
### Strapi Version
### Operating System
### Database
### Javascript or Typescript
### Reproduction URL        (optional)
### Bug Description
### Steps to Reproduce
### Expected Behavior
### Logs        (optional)
### Code Snippets        (optional)
### Media        (optional)
### Additional information        (optional)
### Confirmation Checklist
```

- Template-enforcing workflows: `issues_dailyCron.yml` (on opened), `issues_handleLabel.yml` (on opened), `template-check-on-new-issue.yaml` (on opened+edited)

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `version: 5` | 18 |
| `issue: bug` | 17 |
| `flag: invalid template` | 11 |
| `severity: high` | 11 |
| `source: core:content-manager` | 6 |
| `source: core:admin` | 6 |
| `status: pending reproduction` | 5 |
| `status: confirmed` | 5 |
| `severity: low` | 3 |
| `source: core:upload` | 3 |
| `Priority: Urgent` | 3 |
| `flag: EE` | 2 |
| `severity: medium` | 2 |
| `severity: critical` | 2 |
| `source: core:data-transfer` | 1 |
| `issue: enhancement` | 1 |
| `source: core:strapi` | 1 |
| `source: cli` | 1 |


## strapi/documentation

- Private vulnerability reporting: **false**
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **false**  (every issue MUST go through a template)
- Templates: `BUG_REPORT.yml`, `DOC_REQUEST.yml`, `config.yml`

### `BUG_REPORT.yml`

- auto-title: `"[Bug]: "`
- auto-labels: `"type: bug"`
- Body must contain these as `### ` headers, spelled exactly:

```
### Link to the documentation page or resource
### Describe the bug
### Additional context        (optional)
### Suggested improvements or fixes        (optional)
### Related issue(s)/PR(s)        (optional)
```

### `DOC_REQUEST.yml`

- auto-title: `"[Request]: "`
- auto-labels: `"type: doc request"`
- Body must contain these as `### ` headers, spelled exactly:

```
### Summary
### Why is it needed?
### Suggested solution(s)        (optional)
### Related issue(s)/PR(s)        (optional)
```

- Template-enforcing workflows: none detected

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `documentation` | 27 |
| `api` | 25 |
| `auto-responded` | 22 |
| `bug` | 20 |
| `enhancement` | 15 |
| `migration` | 7 |
| `plugins` | 7 |
| `admin-panel` | 6 |
| `database` | 6 |
| `needs-human-review` | 5 |
| `priority` | 5 |
| `authentication` | 4 |
| `installation` | 3 |
| `i18n` | 3 |
| `deployment` | 2 |

## Quirks learned by filing (hand-written, keep across regenerations)

**Two bots, and only one of them closes.** `github-actions[bot]` runs the template checker and adds `flag: invalid template`. Then `linear-code[bot]` closes the issue as not-planned in reaction to that label, about 35 seconds later. Fixing the body afterwards makes the checker remove the flag, but linear-code never reopens, and a first-time-contributor author cannot reopen an issue closed by someone else. **The format has to be right on the first submit.** If one does get closed, file a fresh correctly formatted issue and reference the closed number rather than trying to rescue it. Note `flag: invalid template` appears on 11 of the 30 most recent issues, so this trap is common.

**Demote your own sub-headings to `####`.** The checker treats every `### ` line as a new section, so a stray `### Cause` inside Bug Description splits the section and can leave a required one empty.

**Dropdowns must use the template's own option values.** `Package Manager`: npm/yarn/pnpm/bun/Other. `Operating System`: MacOS, Linux (Debian/Ubuntu), Windows 11, Docker/Podman/LXC and so on. `Database`: SQLite/PostgreSQL/... `Javascript or Typescript`: Javascript/Typescript. `Strapi Version` must be a real version; "Latest" is explicitly rejected.

Code fences are handled correctly by the parser, so request and response blocks inside ``` are safe.

**`dosubot` is the triage bot and it reads the report properly.** On both filed issues it verified the root cause against current `develop`, agreed with the proposed fixes, wrote patch code, and applied labels within ninety seconds. It picks up a `Suggested labels` line from the body, so include one.

**Derive the source label from the culprit file's package, not from the feature name.** On the second filing dosubot chose `source: core:content-manager` over the `source: core:strapi` the body suggested, because the culprit lived under `packages/core/content-manager/`. Severities are named (`severity: high`), never numeric; dosubot invented `severity: 2` once, which does not exist here.

**Security goes to GHSA only,** per SECURITY.md, with a mandatory AI-usage disclosure section. The exact rules live in `.github/scripts/issue-template-check.ts` in that repo if the checker changes.
