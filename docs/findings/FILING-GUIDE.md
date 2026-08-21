# How to file these findings upstream

The playbook for turning a draft in `issues/` into a filed upstream issue. Written after the first filing (strapi/strapi #27417) was auto-closed by a bot within 35 seconds. Read this before filing anything.

## The rule that cost us the first issue

**An issue body must match the destination repo's issue-FORM structure exactly. Good prose in the wrong shape gets auto-rejected.**

Many repos run a bot that parses the submitted body for the section headers of their `ISSUE_TEMPLATE/*.yml` and flags anything that does not match. Our first draft used a tidy Markdown table for the environment fields and custom headings for the rest. The bot read that as "every required field missing."

What happened on strapi/strapi #27417, from the issue timeline:

| time | actor | event |
|---|---|---|
| 19:52:39 | `github-actions[bot]` | added label `flag: invalid template` |
| 19:53:14 | `linear-code[bot]` | **closed the issue as not planned**, reacting to that label, 35 seconds later |
| 19:58:37 | `github-actions[bot]` | removed the flag after we reformatted the body |

Two separate bots. The template checker only labels; the repo's Linear integration is what closes. Three consequences:

1. **Reformatting after the fact does not undo the close.** `linear-code[bot]` closes on label but does not reopen on unlabel.
2. **We cannot reopen it ourselves.** The filing account is a first-time contributor (`NONE` association), and GitHub does not let a non-collaborator author reopen an issue closed by someone else. It sits closed until a maintainer acts.
3. **So the format has to be right on the first submit.** If an issue does get bot-closed, prefer filing a fresh correctly-formatted issue (the bot's own message suggests exactly that) over editing the closed one, and reference the closed number so a maintainer can dedupe.

Note the trap is common, not exotic: `flag: invalid template` was on 8 of the 25 most recent strapi/strapi issues when we checked.

The content itself was never the problem. Strapi's AI triage bot (`dosubot`) reviewed the same report and confirmed the mechanism in current `develop`, agreed with both proposed fixes, and suggested labels.

## Per-repo rules live with the target

The template sections, enforcement bots, label vocabulary and hard-won quirks for each target are in that target's own file:

- `targets/strapi/FILING.md` (strapi/strapi and strapi/documentation)
- `targets/documenso/FILING.md`
- `targets/caldiy/FILING.md` (calcom/cal.diy and calcom/help)

**Regenerate before every filing batch and read the diff.** Templates, workflows and label vocabularies drift, and a stale copy is what gets an issue auto-closed:

```bash
python3 tools/fetch-filing-rules.py targets/<t> <owner>/<repo> [<owner>/<repo> ...]
```

The generated part covers private-vulnerability-reporting status, `blank_issues_enabled`, every template's required `### ` section headers, auto-titles and auto-labels, template-enforcing workflows and their triggers, and the labels actually in use on the 30 most recent issues. Below it, each file has a hand-written "Quirks learned by filing" section that the tool cannot detect; that section survives regeneration, so keep adding to it as we learn.

Adding a new target is: create `targets/<name>/`, run the tool against its repo, read the output, and start a quirks section as you go.

## Labels

**Before filing, review the last 10 to 20 issues in the target repo and copy the label vocabulary they actually use.**

```bash
gh issue list --repo <owner>/<repo> --state all --limit 25 \
  --json number,title,labels \
  --jq '.[] | "#\(.number) [\((.labels|map(.name))|join(", "))]  \(.title[0:60])"'
```

Our filing account **cannot** apply labels. Verified, not assumed: `gh issue edit <n> --add-label ...` as `truecourse-agent` returns

```
truecourse-agent does not have the correct permissions to execute `AddLabelsToLabelable`
```

Applying labels needs triage or write access, which an outside contributor does not have. Every outside-filed issue in these trackers therefore starts with zero labels.

**The workaround works, and is proven.** Put a `#### Suggested labels` line in the body with the repo's real label names. On strapi/strapi #27418, `dosubot[bot]` applied all four suggested labels verbatim within one minute of filing (`issue: bug`, `severity: high`, `source: core:admin`, `version: 5`) and proposed one more (`status: pending reproduction`). Getting the vocabulary right matters: on the earlier #27417 the same bot invented `severity: 2`, which does not exist in that repo, whereas when the body suggested the real `severity: high` it used that instead.

strapi/strapi taxonomy, sampled from issues #27350 to #27417:

| group | values | notes |
|---|---|---|
| type | `issue: bug`, `issue: enhancement` | on 15 of 25 |
| severity | `severity: low`, `medium`, `high`, `critical` | **named, not numeric**. dosubot suggested "severity: 2" on #27417; that label does not exist here |
| source | `source: core:admin`, `core:content-manager`, `core:upload`, `core:strapi`, `core:data-transfer`, `cli` | |
| status | `status: confirmed`, `status: pending reproduction` | maintainer-applied |
| version | `version: 5` | on 16 of 25, effectively mandatory |
| other | `flag: EE`, `Priority: Urgent`, `flag: invalid template` | last one is the auto-flag to never trigger |

Mapping for this batch: admin-token findings to `source: core:admin`; MCP findings to `source: core:strapi` or `core:content-manager`; Content Manager UI to `source: core:content-manager`; REST and routing to `source: core:strapi`. All carry `issue: bug` and `version: 5` plus a severity.

Worth cross-linking from our MCP drafts, since they are live neighbours: #27395 (MCP `tools/list` advertises draft-07 JSON Schema), #27353 (MCP tool names collide for content types sharing an API), #27397 (Content Manager list view draft/publish status).

## Evidence and transcripts

Drafts end with "the full transcript is available on request" instead of pasting it. That is deliberate, and the numbers behind it:

- **Size**: one scenario transcript is about 27 KB against GitHub's 65 KB issue-body limit, so a single transcript eats 40 percent of the body and buries the report. A full evidence directory is about 96 KB with screenshots.
- **Secrets**: transcripts contain live credentials (admin JWT, token `accessKey`, seeded passwords). They need a redaction pass before publication.
- **Redundancy**: the draft already inlines the exact requests and responses that prove the claim, which is what a maintainer needs to reproduce.

**Do not publish evidence to a gist, and do not link one from an issue.** Tried on the first filing and reverted: it puts a second public artifact under a second account, it adds a redaction surface that has to be right every time (the tooling nearly leaked a live admin key on its first run), and it buys little, because the issue body already contains the exact requests and responses a maintainer needs to reproduce.

The draft's closing line offers the full transcript on request. That is the policy. If a maintainer actually asks, redact with the tool below, then hand over the redacted files by whatever route they prefer.

Screenshots are the exception: attach them directly to the issue when the finding is visual (the Strapi bulk-unpublish dialog, the Documenso send screen), since the templates have a Media or Screenshots field.

### Redacting, when evidence does have to leave the machine

`tools/redact-transcript.py` replaces credentials with stable `<REDACTED:name>` placeholders (the same secret always maps to the same placeholder, so a reader can still follow which credential went where).

```bash
# ALWAYS dry-run first and read the residual scan
python3 tools/redact-transcript.py <files...> --check

# then write the redacted copies
python3 tools/redact-transcript.py <files...> -o /tmp/redacted
```

**Never skip the `--check` pass.** On its first run it reported the plain transcript as clean but flagged three live-capture files, and the flag was right: guard transcripts embed response bodies as *escaped* JSON, so a key appears as `\"accessKey\":\"...` as well as `"accessKey":"..."`, and the first version of the patterns matched only the unescaped form. A real 256-character admin key would have gone out. The patterns now accept either quote form, and the residual scanner is deliberately noisy (it also flags long hex runs, which harmlessly matches git SHAs) on the principle that a false positive costs a glance while a false negative leaks a credential.

Always re-scan what actually left the machine, not just what the tool generated.

## Positioning, and pace

**We file openly as an agent.** The account is `truecourse-agent`, every report closes by saying it was found by a pipeline reading the product's own documentation against a live instance, and security reports carry an explicit AI-usage disclosure. Nothing here is disguised as human work, and it must not be. If a maintainer asks how a finding was produced, tell them plainly.

That means the reason to pace is **not** to look human. It is three other things:

1. **GitHub's abuse heuristics do not read intent.** They pattern-match on account age and content-creation rate. A young account can be flagged whether or not it is honest about what it is, and a suspension takes every filed report down with it. This is a mechanical constraint to route around.
2. **Maintainer bandwidth is finite.** Dropping a dozen reports on a tracker at once is inconsiderate even when every one is correct. Responsiveness is a resource: on the first target, two reports produced two fixes inside a day. Do not exhaust that.
3. **Every report has to be worth a maintainer's time.** This is the real limit, and it does not scale with volume. A verified, reproduced, root-caused report earns the next one a reading; a thin one costs credit for the whole batch.

Working rules that follow:

- **2 to 3 public issues a day**, alternating targets, until the account has a track record. Revisit once it does; the constraint is heuristics and courtesy, not a rule of nature.
- **Private advisories are exempt.** They are not public content and carry no abuse signal.
- **PR comments and follow-ups on live threads are cheap.** A follow-up arising from an active conversation reads differently from a cold report, both to a human and to the heuristics.
- **Prefer a new issue over a comment on a closed one.** A comment on an issue closed months ago is a weak vehicle; it may never be read and it cannot be triaged. When a finding matches an issue that was closed as fixed but demonstrably is not, file a new issue that references the old one in plain words, states without edge that it appears to have been closed prematurely, gives the evidence, and invites the maintainers to reopen the original instead if they prefer. Commenting is still right on an OPEN thread, such as a pull request actively touching the code.
- **A promise made in a thread is a commitment.** If a comment says a separate issue will be opened, open it.
- **Give the account a real profile.** Since it files openly as an agent, its profile should say so: what the pipeline does, that a human reviews before filing, and how to reach a person. That is the honest version of "looks legitimate", and it is worth more than any pacing trick.

## The filing procedure

```bash
# 1. Strip the draft's front matter and the duplicate H1 (the title is passed separately)
awk 'BEGIN{d=0} /^---[[:space:]]*$/{d++; next} d>=2{print}' "$DRAFT" | sed '/./,$!d' > /tmp/body.md

# 2. Sanity-check the body against the repo's template BEFORE posting
grep -nE '^### (Node Version|Package Manager|Strapi Version|Bug Description|Steps to Reproduce|Expected Behavior)$' /tmp/body.md
grep -nE '^- \[x\]' /tmp/body.md
grep -cE '^(finding|target|route|status|reverified):' /tmp/body.md   # must be 0

# 3. Switch to the filing account
gh auth switch -u truecourse-agent

# 4. File
gh issue create --repo <owner>/<repo> --title "<title from front matter>" --body-file /tmp/body.md

# 5. Watch for the bots for ~60 seconds; a template checker fires immediately
gh issue view <n> --repo <owner>/<repo> --json state,stateReason,labels,comments

# 6. Restore the human account
gh auth switch -u mushgev
gh config set -h github.com git_protocol ssh
```

For a PR comment instead of a new issue: `gh pr comment <n> --repo <owner>/<repo> --body-file /tmp/body.md`.

Security disclosures are **not** `gh` commands. They go through web forms: GitHub's private "Report a vulnerability" page for the repo (Strapi accepts only this channel and requires a mandatory AI-usage disclosure section), Documenso's advisory form, and for Cal.diy the advisory form plus a cc to security@cal.com.

After each filing, record the URL in three places: the draft's front matter (`status: filed`, `filed_url`, `filed_at`), the finding's `reverify/<repo>/<ID>.json` under `filed`, and the "Filed" section of `STATE.md`.

## Checklist before hitting send

- [ ] Body matches the repo's template section headers exactly, own sub-headings demoted to `####`
- [ ] Required checkboxes present and checked
- [ ] Dropdown values are real options from the template; version is a real version
- [ ] Front matter stripped, no duplicate H1
- [ ] Suggested labels line present, using the repo's real taxonomy
- [ ] Related existing issues cross-linked
- [ ] No credentials in any quoted request or response
- [ ] Filing as `truecourse-agent`, and switch back afterwards
