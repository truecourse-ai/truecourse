# Re-verify research brief (plan steps 1 and 2: upstream state + tracker dedupe)

You are re-verifying a set of findings from `docs/findings/targets/<target>/report.md` before they are filed upstream. For EACH finding assigned to you, decide (a) whether the defect / doc bug is still present in the upstream default branch today, (b) whether anyone has reported or fixed it since 2026-08-15, and (c) whether every upstream item the original review cited is still in the state the review recorded. You do not file anything. You write one JSON per finding.

All paths below are absolute or relative to `/Users/musheghgevorgyan/repos/truecourse/docs/findings/targets/`.

## Ground rules

- READ ONLY on the source clones. Never `git checkout`, `switch`, `reset`, `stash`, `pull`, or edit files in them. Use `git log`, `git show <rev>:<path>`, `git diff <a> <b> -- <path>`, `git blame`, `git log -S/-G`, `git tag --contains`, `git merge-base --is-ancestor`. They are partial clones (`--filter=blob:none`): the first `git show`/`blame` on a file fetches the blob and may take a few seconds.
- GitHub search is rate limited to 30 requests/min for the whole account and FIVE other agents are searching at the same time. Rules: at most 2 `gh search issues` / `gh search prs` / `gh api search/...` / `gh issue list --search` calls per finding; run `sleep 20` immediately before every search call; on any 403 / "rate limit" / "secondary rate limit" error, `sleep 90` and retry once. `gh api repos/<owner>/<repo>/issues/<n>`, `gh api repos/<owner>/<repo>/pulls/<n>`, `gh issue view`, `gh pr view`, `gh api repos/<owner>/<repo>/commits?path=...` are NOT search calls and are unrestricted.
- No live production service is touched. No writes anywhere except your output files.
- Do not guess. Where evidence does not settle a point, say so and say what would settle it.
- No em dashes anywhere in your output. Use commas, colons, or plain hyphens.

## Inputs

- `FINDINGS-INDEX.json` (in `filing/`): for each finding id the scenario ids, the per-scenario review JSON(s), `reviewPart` (which part of a multi-defect JSON is this finding), the culprit files to git-log, the upstream items the review cited (`citedUpstream`), and for doc bugs the doc repo and doc files.
- `targets/STATE.md`: the clone locations, today's heads, the tested commits, and the tags created since 2026-08-15 (strapi v5.52.1 on 2026-08-19; documenso v2.17.0 on 2026-08-19 = main head; cal.diy none).
- `<repo>/<scenario-id>.json`: the original review of the failure (verdict, docClaim quote + doc path, observed, rootCause file:lines + explanation, introducedBy, upstream issues/prs/queries, fixedAfter, notes). Read the whole file for each of your findings; for multi-defect files read the `additionalDefects[]` entry named by `reviewPart`.
- The report tables in the target's `report.md` for the one-line defect statements.
- Source clones (see STATE.md for heads):
  - strapi: `src/strapi` (origin/develop, today) and `src/strapi-tested` (worktree at the tested commit). The Strapi user docs are a separate repo: `src2/strapi-documentation` (origin/main, refreshed today; doc files under `docusaurus/docs/cms/...`).
  - documenso: `src/documenso` (origin/main = v2.17.0) and `src/documenso-tested` (v2.16.0). Docs live in `apps/docs/content/docs/...` of the same repo.
  - cal.diy: `src/caldiy` (origin/main, 176037d0af) and `src/caldiy-tested` (038381aeca). `src/calcom` is calcom/cal.com, a mirror at the same commit (commercial source is private; nothing is verifiable there from source). Cal.com's public docs were snapshotted under `/Users/musheghgevorgyan/repos/cal.diy/.truecourse/specs/sources/cal.com-docs/` and `cal.com-help/`; the help centre source is `calcom/help` on GitHub (use `gh api repos/calcom/help/contents/<path>` or `gh api repos/calcom/help/commits?path=<path>` to check it, no clone needed).
- The guard stores (scenario yaml + evidence) if you need the exact request/response: `/Users/musheghgevorgyan/repos/<strapi|documenso|cal.diy>/.truecourse/` (`scenarios/<area>/<id>.yaml`, `guard/evidence/<runId>/<id>/transcript.txt`; `guard/LATEST.json` `scenarios[].evidencePath` is authoritative for which run dir holds the evidence).

## What to do per finding

1. **Source state today.** In the upstream clone: `git log --format='%h %ad %s' --date=short <tested>..origin/<default> -- <each culprit file>` (tested and default from FINDINGS-INDEX / STATE.md). For every commit that touches a culprit file, `git diff <tested> origin/<default> -- <file>` and READ the hunk(s) around the culprit lines named in `rootCause.lines` (re-locate the lines in today's file with `git show origin/<default>:<file> | grep -n ...`; line numbers drift). Decide one of:
   - `unchanged`: no commit touched the culprit file, or none touched the culprit lines (say which).
   - `changed-bug-remains`: the file/lines changed but the faulty behavior is still there (explain, quote the lines as they are today with today's line numbers).
   - `fixed`: a commit changed the faulty behavior (name sha, date, PR number from the `(#NNNN)` suffix, one sentence on what it does). Then `git tag --contains <sha>` to say whether it is in a release (strapi v5.52.1, documenso v2.17.0, cal.diy none), and, if the fix is in a release, the release date.
   - `unclear`: say exactly what you could not determine.
   For findings already marked fixed by the review (D6 by PR #3081, C12 by PR #29740): confirm the fix commit is on the default branch and whether the new tag contains it (`git merge-base --is-ancestor <sha> v2.17.0`), and record the permalink.
   Also record today's permalink for the culprit lines: `https://github.com/<owner>/<repo>/blob/<default-head-sha>/<file>#L<a>-L<b>` with the line numbers as they are at today's head, AND the permalink at the tested commit (for the issue's "Cause" section).
2. **Doc state today (doc bugs only, kinds `doc`).** Is the wrong sentence still in the doc source today? For Strapi: `git log <reviewed>..origin/main -- docusaurus/docs/cms/<file>` in `src2/strapi-documentation` (the review read the docs at c768c7bf, 2026-08-15) and `git show origin/main:<file> | grep -n "<phrase>"` to get today's line numbers; then the permalink `https://github.com/strapi/documentation/blob/<head>/<file>#L<n>` and the published URL (https://docs.strapi.io/cms/...). For Documenso: same in `src/documenso` under `apps/docs/content/docs/...`, published at https://docs.documenso.com/... . For Cal.diy C14/C15: the text lives in `slots.controller.ts` decorators in the product tree and in `docs/api-reference/v2/openapi.json`; for C16 in `calcom/help` (`bookings/prefill-fields.mdx`) and its mirror in `calcom/docs`; check the current content via `gh api repos/calcom/help/contents/...` (base64) and the commit history of that path.
3. **Tracker dedupe.** Re-run the queries recorded in the review JSON `upstream.queries` (you may merge them into at most 2 searches per finding; add `created:>2026-08-10` or `updated:>2026-08-10` qualifiers to catch only new activity; include `--include-prs` or search PRs when the original did) plus, if budget allows within the 2, one search by the exact symptom phrase. Record every new exact or related issue/PR with number, url, state, title, created date, relation (exact | related), and a one-line note on how it relates. "None found" is a valid answer; record the queries verbatim.
4. **Cited items.** For every item in `citedUpstream` (FINDINGS-INDEX) and every issue/PR listed in the review JSON `upstream.issues[]` / `upstream.prs[]`: `gh api repos/<owner>/<repo>/issues/<n>` (works for PRs too; for PRs also `gh api repos/<owner>/<repo>/pulls/<n>` to get `merged_at`, `merge_commit_sha`, `base.ref`). Record state today (open / closed / merged, and for merged the merge date and sha) and whether it changed since the review (the review recorded the state as of 2026-08-15). If a cited PR merged since, re-evaluate: does it fix this finding (read its diff with `gh pr diff <n> --repo ...` and compare to the culprit)? For the Documenso docs stack #3133-#3139 and #3136 specifically: state, base branch, whether still stacked on a non-main base, any maintainer comment since 2026-08-15 (`gh api repos/documenso/documenso/issues/<n>/comments`).
5. **Re-evaluation.** One paragraph: does the finding stand today, and has anything changed its verdict, confidence, or scope? If the review's `fixedAfter` or `upstream` claims are now wrong, say so explicitly.
6. **Route suggestion.** One of: `public issue` | `security disclosure` | `docs repo issue` | `comment on existing PR <n>` | `skip: fixed (in <release>)` | `skip: reported (<ref>)` | `skip: not a finding`. Security candidates (FINDINGS-INDEX `securityCandidate: true`) are routed per the repo's security policy; read the policy (below) before suggesting, and say which policy sentence applies.

## Per-repo policy (ONE agent per repo does this; your prompt tells you whether that is you)

Read and summarize into `filing/reverify/<repo>/POLICY.md`:
- `SECURITY.md` / `.github/SECURITY.md` / the repo's security policy page (`gh api repos/<owner>/<repo>/security-advisories` is not needed; `gh api repos/<owner>/<repo>/community/profile` tells you whether a security policy exists, and `gh api repos/<owner>/<repo>/contents/SECURITY.md` fetches it). What does it say: private report via GitHub Security Advisories ("Report a vulnerability" button), an email address, a third-party platform (HackerOne, huntr, etc.), scope exclusions (rate limiting, a11y, self-hosted-only, etc.)?
- `CONTRIBUTING.md` and the issue templates under `.github/ISSUE_TEMPLATE/` (list the template files and their required sections / frontmatter `title`, `labels`; `gh api repos/<owner>/<repo>/contents/.github/ISSUE_TEMPLATE`). Note anything that shapes a bug report: required "Steps to reproduce / Expected / Actual", version fields, a discussion-first rule, a "bug reports go to X" statement, a reproduction-repo requirement.
- For the docs repos too: strapi/documentation (issue templates, CONTRIBUTING), calcom/help (how doc fixes are taken: issue vs PR), calcom/docs.
- For Documenso: apps/docs lives in the main repo; is there a docs-specific issue template or label?
Write it plainly, quoting the operative sentences, with the URLs.

## Output

One file per finding: `filing/reverify/<repo>/<ID>.json` (repo dir is `strapi`, `documenso` or `caldiy`; ID as in FINDINGS-INDEX, e.g. `S1`, `D2a`, `C12`). Schema:

```json
{
  "id": "S1",
  "repo": "strapi",
  "checkedAt": "2026-08-19",
  "defaultHead": "sha of origin/<default> you checked against",
  "source": {
    "status": "unchanged | changed-bug-remains | fixed | unclear",
    "commitsOnCulpritFiles": [ { "sha": "", "date": "", "title": "", "pr": "#NNNN or null", "touchesCulpritLines": true, "effect": "one sentence" } ],
    "fix": null,
    "fixExample": { "sha": "", "pr": "#NNNN", "date": "", "inRelease": "v2.17.0 | none", "releaseDate": "YYYY-MM-DD or null", "note": "" },
    "permalinkTested": "https://github.com/<owner>/<repo>/blob/<tested-sha>/<file>#L<a>-L<b>",
    "permalinkToday": "https://github.com/<owner>/<repo>/blob/<head-sha>/<file>#L<a>-L<b>",
    "howDecided": "what you read and compared"
  },
  "docs": null,
  "docsExample": { "stillPresent": true, "file": "", "lineToday": 0, "permalink": "", "publishedUrl": "", "commitsSinceReview": [], "note": "" },
  "tracker": {
    "newItems": [ { "number": 0, "url": "", "state": "open|closed|merged", "title": "", "createdAt": "", "relation": "exact|related", "note": "" } ],
    "citedItems": [ { "ref": "owner/repo#n", "kind": "issue|pr", "stateAtReview": "", "stateToday": "", "changedSinceReview": false, "mergedAt": null, "mergeCommit": null, "baseRef": null, "note": "" } ],
    "queries": [ "verbatim queries with the date qualifiers" ]
  },
  "reevaluation": "one paragraph",
  "routeSuggestion": "public issue | security disclosure | docs repo issue | comment on existing PR <n> | skip: fixed (in <release>) | skip: reported (<ref>) | skip: not a finding",
  "policyBasis": "the sentence of SECURITY.md / CONTRIBUTING.md that drives the route, or null",
  "confidence": "high | medium | low",
  "notes": "anything a filer must know (e.g. which half of a multi-part finding an open PR covers)"
}
```

Use `fix` (object or null) and `docs` (object or null); the `*Example` keys only show the shape, do not emit them. Write valid JSON (python3 -c 'import json;json.load(open(...))' to check). When done, reply with 3 to 6 plain lines: per finding id, the source status, the route suggestion, and any surprise. Nothing else.
