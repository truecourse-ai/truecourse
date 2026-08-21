# Ingest and re-verify brief (second wave: trilium, rybbit, nocobase, reactive-resume)

You are re-verifying one product's findings before any of them are filed upstream. The findings were already hand-verified on 2026-08-21 against clean instances built for the purpose, so **you are not re-running the product**. Your job is the two things that go stale: whether the defect is still present in the source today, and whether anyone has reported or fixed it since.

You write JSON. You file nothing.

## Your inputs

- `docs/findings/targets/<target>/report.md` - the hand-verification report for your product. It opens with a cross-reference table mapping finding to corpus scenario id (with failing step) and to upstream issue/PR state as of 2026-08-21. Each finding has a probe and a control. This is the source of truth for what the finding *is*.
- `docs/findings/targets/REAL-BUGS-2026-08-21.md` - the cross-product summary, with the scoreboard and the one-paragraph statement of each finding.
- `docs/findings/targets/<target>/FILING.md` - the destination repo's issue template, label vocabulary and enforcement state, generated today.
- The product clone at `/Users/musheghgevorgyan/repos/<target>/`, on its default branch, blobless. The tested commit is present.
- The guard store at `/Users/musheghgevorgyan/repos/<target>/.truecourse/`: `scenarios/<area>/<id>.yaml` for the exact steps, `guard/LATEST.json` for the run, and `guard/evidence/<runId>/<id>/` for transcripts and screenshots. Use these to ground a finding in its actual request and response.
- `/Users/musheghgevorgyan/repos/<target>/reference/` - the corpus notes the run was built from.

Tested commits and drift as of today:

| target | repo | branch | tested | commits since |
|---|---|---|---|--:|
| trilium | TriliumNext/Trilium | main | `3a73bc35` | 10 |
| rybbit | rybbit-io/rybbit | master | `613cd015` | 4 |
| nocobase | nocobase/nocobase | main | `d8d8cb4b` | 3 |
| reactive-resume | AmruthPillai/Reactive-Resume | main | `3221afda` | 0 |

## Ground rules

- **Read-only on the clone.** No `checkout`, `switch`, `reset`, `stash`, `pull`, no edits. Use `git log`, `git show <rev>:<path>`, `git diff`, `git blame`, `git log -S`. Blobless clone: the first read of a file fetches it, which is fine.
- **Search budget.** Four agents share 30 GitHub searches a minute. At most **2 search calls per finding**, `sleep 20` before each, and on a rate-limit error `sleep 90` and retry once. `gh api repos/.../issues/<n>`, `gh pr view`, `gh issue view` are not searches and are unrestricted.
- **Do not guess.** If source and tracker do not settle something, say `unclear` and state exactly what would settle it.
- **No em dashes** anywhere in your output.
- Do not touch any live service. Read-only on GitHub.

## Per finding, do this

1. **Identify it.** Take the finding id from the report (T1, R3, N7, D2 and so on, whatever that report uses), its one-line statement, its scenario id and failing step, and the culprit file and lines if the report names them. If the report does not name a culprit file, find it: the scenario yaml and the evidence transcript tell you what was called, and the report's mechanism paragraph tells you what to look for.
2. **Source state today.** `git log --format='%h %ad %s' --date=short <tested>..origin/<branch> -- <culprit files>`. For every commit that touches them, read the diff around the culprit lines. Then decide:
   - `unchanged` (no commit touched the file, or none touched the culprit lines: say which),
   - `changed-bug-remains` (quote today's lines with today's numbers),
   - `fixed` (name sha, date, PR number, one sentence on what it does; then `git tag --contains <sha>` and say whether it is in a release),
   - `unclear`.
   Record permalinks at both the tested commit and today's head.
3. **Tracker.** The report already records upstream state as of 2026-08-21; re-check each item it cites with `gh api repos/<owner>/<repo>/issues/<n>` (and `pulls/<n>` for merge state) and say whether it moved. Then run your own search for anything new since 2026-08-20, including the exact symptom phrase. Record number, url, state, title, created date, relation (exact or related) and a one-line note.
4. **Re-evaluation.** One paragraph: does the finding stand today, and has anything changed its scope, severity or confidence? If the report's own upstream claims are now wrong, say so.
5. **Route.** One of `public issue`, `security disclosure`, `docs repo issue`, `comment on existing PR <n>`, `skip: fixed (in <release>)`, `skip: reported (<ref>)`, `skip: not a finding`. Base it on `FILING.md` for the destination repo, and on whether the finding touches a security boundary. Findings the report marked PARTIAL or NOT REPRODUCED need explicit handling: say whether the corrected statement is still filable, and file the corrected statement, never the original wrong one.

## Output

One file per finding: `docs/findings/targets/<target>/reverify/<ID>.json`

```json
{
  "id": "T1",
  "repo": "TriliumNext/Trilium",
  "target": "trilium",
  "checkedAt": "2026-08-20",
  "title": "one line, what a maintainer would read",
  "statement": "two or three sentences: what the product does versus what the docs or its own contract promise",
  "scenario": {"id": "...", "failingStep": 0, "evidencePath": "..."},
  "handVerified": {"verdict": "CONFIRMED | PARTIAL | NOT REPRODUCED", "note": "from the report, including any correction it made"},
  "defaultHead": "sha checked against",
  "source": {
    "status": "unchanged | changed-bug-remains | fixed | unclear",
    "culpritFiles": ["..."],
    "commitsOnCulpritFiles": [{"sha": "", "date": "", "title": "", "pr": "#N or null", "touchesCulpritLines": true, "effect": ""}],
    "fix": null,
    "permalinkTested": "",
    "permalinkToday": "",
    "howDecided": ""
  },
  "tracker": {
    "citedItems": [{"ref": "owner/repo#n", "kind": "issue|pr", "stateAtReport": "", "stateToday": "", "changedSinceReport": false, "note": ""}],
    "newItems": [{"number": 0, "url": "", "state": "", "title": "", "createdAt": "", "relation": "exact|related", "note": ""}],
    "queries": ["verbatim"]
  },
  "reevaluation": "one paragraph",
  "routeSuggestion": "...",
  "suggestedLabels": ["from FILING.md's observed vocabulary"],
  "confidence": "high | medium | low",
  "notes": "anything a filer must know"
}
```

Validate each file parses (`python3 -c 'import json;json.load(open(...))'`).

Also write `docs/findings/targets/<target>/reverify/INDEX.json`: `{"target": "...", "repo": "...", "tested": "...", "defaultHead": "...", "checkedAt": "2026-08-20", "findings": [{"id": "...", "title": "...", "route": "...", "source": "...", "confidence": "..."}]}` ordered by filing priority, strongest first, with a one-line `priorityNote` on each explaining the rank.

When done, reply with at most 12 plain lines: per finding id, source status and route, then any surprise.
