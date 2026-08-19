# Issue drafting brief (plan step 5)

You draft upstream issue texts for findings that the re-verify research (and, where available, the live re-run) says still stand. Nothing is filed; the drafts are for human approval. One file per finding, one issue per defect.

All paths are absolute or relative to `/Users/musheghgevorgyan/repos/truecourse/docs/findings/strapi-documenso-caldiy/`.

## Inputs per finding

- `filing/FINDINGS-INDEX.json`: id, scenario ids, review JSON path(s), `reviewPart`, culprit files, docs repo.
- `<repo>/<scenario-id>.json`: the original review (docClaim quote + doc path, observed, rootCause file:lines + explanation, introducedBy commit/PR/date, notes with a maintainer-facing repro recipe). For multi-defect JSONs use the part named by `reviewPart`.
- `filing/reverify/<repo>/<ID>.json`: today's source state (unchanged / changed / fixed), permalinks at the tested commit and at today's head, tracker dedupe results, cited items' state, the route suggestion and its policy basis.
- `filing/reverify/<repo>/POLICY.md`: the repo's SECURITY.md / CONTRIBUTING / issue-template requirements. Follow the template's section names when the repo has one (e.g. a required "Steps to reproduce / Expected behavior / Actual behavior / System" block): keep our content, but put it under their headings, and fill the version fields.
- `filing/live/<repo>/<ID>/repro.md` and `filing/live/<repo>/summary.json` if present: the live re-run verdict on today's build, with exact requests and responses. If the live dir does not exist yet, write the issue from the original evidence and put the line `RE-VERIFY: pending` where the re-verification sentence goes (a later pass fills it).
- The guard store (`/Users/musheghgevorgyan/repos/<strapi|documenso|cal.diy>/.truecourse/`): `scenarios/<area>/<id>.yaml` for the exact request bodies, `guard/evidence/<run>/<id>/transcript.txt` for the exact responses. Quote real bodies and real responses; redact tokens as `<token>`.
- The doc snapshots: `/Users/musheghgevorgyan/repos/<repo>/.truecourse/specs/sources/<site>/...` hold the published page text the scenario bound to; the published URL is derivable from the path (docs.strapi.io/cms/..., docs.documenso.com/docs/..., cal.com/docs/... or cal.com/help/...). Quote the doc sentence exactly.

## Shape of an issue draft

File: `filing/issues/<target>/<ID>-<slug>.md` where `<target>` is the repository the issue is filed in: `strapi` (strapi/strapi), `strapi-documentation` (strapi/documentation), `documenso` (documenso/documenso, code and apps/docs alike), `caldiy` (calcom/cal.diy), `calcom-help` (calcom/help). `<slug>` is 3 to 6 lowercase words joined by hyphens.

Front matter block at the top (machine-readable, stays in the file, is not pasted):

```
---
finding: S1
target: strapi/strapi
route: public issue | security disclosure | docs repo issue | comment on existing PR #NNNN
title: <the issue title>
labels: <labels the repo's template would apply, or none>
status: draft
reverified: <yes (build sha/tag, date) | pending | no: could not reproduce (why)>
---
```

Then the body, ready to paste or to `gh issue create --body-file`:

1. **Title** line (as `# <title>`): one sentence a maintainer can triage from, concrete, no adjectives: what happens, on what surface. Example: "Admin token permissions on localized content types are deleted at every server restart".
2. **Summary**: one paragraph. What the docs promise, what the product does, who it hurts, in that order. No selling, no "critical", no "we".
3. **Docs**: the exact sentence(s) quoted, with the page URL (and the doc repo file path for doc issues).
4. **Reproduce**: the build tested (version, tag or sha, and how it was run: from source, sqlite, etc.), then numbered steps with the exact requests (method, path, headers that matter, JSON body) or UI clicks. Use the scenario yaml's bodies. Keep the minimal path: only the steps that matter. Then "Re-verified on <today's build> on <date>: <still reproduces | ...>" from the live result, or the `RE-VERIFY: pending` marker.
5. **Observed** and **Expected**: two short blocks, observed quoting the actual response (status, body excerpt), expected stating what the docs or the schema say should happen.
6. **Cause**: one paragraph pointing at the code: `<file>:<lines>` as a permalink at the TESTED commit (from the reverify JSON `source.permalinkTested`), what the code does, the PR that introduced it (number, date) when known, and whether today's head still has it (from `source.status`, with the today permalink). For doc issues: the doc file and line, what the product actually does with the code reference, and what the sentence should say (suggest the wording).
7. **Related**: existing issues/PRs the review or the dedupe found (number and one clause on how they relate). Omit the section if there are none.
8. Closing line, exactly in this spirit: "Found by TrueCourse running the product's own documentation against a live instance; the full transcript (requests, responses, server log) is available on request." Adapt "the product's own documentation" to "the published API docs" etc. if more precise. No links to TrueCourse, no marketing.

Rules:
- No em dashes anywhere. Use commas, colons, or hyphens.
- Plain, factual, short sentences. Write for a maintainer who has 2 minutes. No "we believe", no "it seems".
- One issue per defect: S2, S3, S4 are three files; D2a and D2b are two files (D2b must say that PR #3136 covers the coordinate half only); D7 and D9 are two files; C11 and C12 are two files (C12 is fixed on main and is a skip unless the route says otherwise: then it is a short note, not an issue).
- Security disclosures (route `security disclosure`): same shape, but the front matter says so and the first line of the body says "Private report via <channel per POLICY.md>". Do not soften the content; do not add exploit tooling beyond the reproduction steps already in the scenario.
- Docs repo issues: the title names the page; the body says what is wrong, what the product does (with the code reference), and the suggested replacement sentence.
- `comment on existing PR #N` routes: write the comment text instead (a paragraph: what we observed that confirms/extends the PR, and what the PR does not cover), in the same file, front matter `route: comment on existing PR #N`.
- Skips (route `skip: ...`): do not write a file; the filing table carries the reason.
- For medium-confidence findings (C1, C9, C10) obey the live result: if the live dir says `could not reproduce` or contradicts, do not draft, write the reason in your reply so the table can carry it.
- Cal.diy caveats: docs at cal.com describe the commercial product; say in the issue that the reproduction is on Cal.diy from source and, where the review says so, that the code predates the fork (C1, C2, C5, C7) or is fork-specific (C8). Do not file the edition mismatches.
- Strapi S17: no draft. Documenso D17: no draft.

When done, reply with the list of files written (one per line, with the route), and the findings you did NOT draft and why. Nothing else.
