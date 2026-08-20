# Filing rules for calcom/cal.diy and calcom/help

**Regenerated 2026-08-20** by `tools/fetch-filing-rules.py`. Templates and label vocabularies drift, so re-run this before each batch and read the diff. The rules that apply to every target live in `../../FILING-GUIDE.md`.

## calcom/cal.diy

- Private vulnerability reporting: **true**  (so `gh api -X POST repos/calcom/cal.diy/security-advisories/reports` works)
- SECURITY.md present: **yes**
- `blank_issues_enabled`: **false**  (every issue MUST go through a template)
- Templates: `bug_report.md`, `config.yml`, `feature_request.md`

### `bug_report.md`

- auto-title: `""`
- auto-labels: `["🐛 bug"]`
- Markdown template, sections: `Issue Summary`, `Steps to Reproduce`, `Actual Results`, `Expected Results`, `Technical details`, `Evidence`

### `feature_request.md`

- auto-title: `""`
- auto-labels: `["✨ feature", "🚨 needs approval"]`
- Markdown template, sections: `Is your proposal related to a problem?`, `Describe the solution you'd like`, `Describe alternatives you've considered`, `Additional context`, `Requirement/Document`, `# House rules`

- Template-enforcing workflows: none detected

- Labels actually used on the 30 most recent issues (we cannot self-apply; put a `Suggested labels` line in the body):

| label | seen |
|---|--:|
| `🐛 bug` | 11 |
| `✨ feature` | 9 |
| `🚨 needs approval` | 9 |


## calcom/help

- Private vulnerability reporting: **false**
- SECURITY.md present: **no**
- `blank_issues_enabled`: **unknown**
- Templates: none found

- Template-enforcing workflows: none detected

## Quirks learned by filing (hand-written, keep across regenerations)

**calcom/cal.com IS calcom/cal.diy.** The repository was renamed and GitHub redirects the old path, so every `calcom/cal.com#NNNN` reference resolves to the same number on cal.diy, and one `--owner calcom` search covers both. `gh search issues --repo calcom/cal.com` is rejected, because search does not follow the rename.

**The commercial Cal.com source is private.** Nothing about the hosted product is verifiable from source, and no report may claim "fixed in cal.com". The docs the findings came from describe the commercial product, so say the reproduction is on Cal.diy from source.

**`bug_report.md` is a Markdown template, not a form**, so no bot parses it, but its Evidence section is called "quite mandatory": every issue needs a captured request and response, a log excerpt or a screenshot.

**Prefer an issue over a pull request.** Main has not merged anything since 2026-08-08, and dozens of community PRs were closed unmerged in a triage sweep on 2026-08-17 to 19. A drive-by PR can be closed within a day without comment; a public security PR already was (29383, closed unmerged in one day with no human review).

**Security:** SECURITY.md still reads as a hosted-service policy and its contact is the commercial company's address, on a community fork's repo. Use the private advisory form on calcom/cal.diy AND cc security@cal.com. Its out-of-scope list includes denial of service, so lead any availability-flavoured finding with the authorization breach and put availability second.

**calcom/docs is obsolete** (its README says so) and calcom/help has no template, no CONTRIBUTING and no SECURITY.md, with PRs almost entirely from staff and the Mintlify bot. API-reference doc bugs belong on cal.diy; help-centre text goes to calcom/help.

**Everything here is still gated on the live re-run** that ran out of disk. Three findings are medium confidence and must not be filed until it confirms them.
