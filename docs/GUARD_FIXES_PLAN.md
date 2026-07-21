# Guard fixes plan — batch 2

Work-plan for the current batch (the agent contract; retired when built). Driving
directives: scenarios are ONE kind — committed by default, some pass, some fail, the
run shows which; and the user must never see tool-caused generation defects.

## 1. Two-sided claims get two-sided tests

STATUS: OPEN

**Problem.** The single largest defect family across 12 battle-tested repos: a claim
asserting inclusion AND exclusion ("range X matches A, B and does not match C, D")
is authored as a test of the matching half only — it would still pass if the logic
were broken. node-semver alone: 24 identical flags. The self-heal re-author often
reproduces the same one-sided shape.

**Fix.** General authoring rule (GENERATE_SYSTEM_PROMPT, no repo-specific tokens,
overfit-guard test): when a claim asserts both what DOES and what does NOT happen,
the scenario must assert both halves — exercise the excluded inputs and assert their
exclusion observably (absent from output, distinct exit, etc.). Align the fidelity
prompt so its flag criteria and the authoring rule state the same requirement.
Fingerprints re-key naturally.

**Tests.** Prompt-content assertions for both prompts + the no-repo-tokens guard;
e2e via the fixture CLI: a two-sided claim yields a scenario whose assertions cover
both halves (capturing runner inspects the authored steps).

## 2. Flagged claims re-author fresh — never served the rejected scenario from cache

STATUS: OPEN

**Problem.** "Re-attempt next generate" is a treadmill: the authoring cache serves
the byte-identical rejected scenario back, it gets flagged again, auto-resolves
again, and only the 2-strike escalation ends the loop — by dumping the defect on the
human. Observed: semver's 24 escalations, each with count=2 and an unchanged
scenario.

**Fix.** When a claim's scenario ends the run flagged (fidelity finding, triage
generation-defect, or auto-resolved as such), record the claim as tainted (the
existing auto-resolutions store already keys finding identity — extend or parallel
it). On the next generate, a tainted claim BYPASSES the author cache and re-authors
fresh with the prior flag's mismatch/brief as correction evidence (reuse the retry
evidence idiom). A clean pass clears the taint. Escalation guard stays as the
backstop but should now rarely fire.

**Tests.** Flagged claim → next generate authors fresh (runner sees the call, with
the mismatch in the prompt) while unflagged claims still cache-hit; taint clears on
a faithful pass; escalation still fires if two FRESH re-authors fail the same way.

## 3. Commit by default — one scenario kind, passing or failing

STATUS: OPEN

**Problem.** Birth-failing scenarios are withheld as findings, so `guard run` stays
green while known drift exists, and the user must learn a second mental model
(findings) to see failures. Directive: all scenarios are the same; some pass, some
fail.

**Fix.**
- Birth outcome no longer gates persistence. After retry/self-heal and triage, a
  scenario COMMITS regardless of pass/fail — with ONE exception serving the
  zero-defect directive: a scenario whose failure triage attributes to the tool
  itself (generation-defect / environment) is never committed as a permanent false
  failure; it stays in the fix loop (items 1+2) exactly as today.
- A committed failing scenario carries its finding data (expected/actual, triage
  verdict + recommendation) as the diagnosis attached to the scenario — findings
  stop being a separate gating stage and become the explanation of a failing test.
- `guard run` executes everything; failing scenarios report as failures with the
  diagnosis one keypress away (CLI drifts + dashboard detail). When a previously
  failing scenario passes (drift fixed), the run reports it plainly — no special
  states, no expected-fail class, no new markers in the schema beyond carrying the
  diagnosis.
- Surfaces: generate summary drops "held/withheld" style language for findings —
  "N scenarios written (M failing — see guard run/drifts)"; coverage paints by run
  outcome as today (fail = red, diagnosis in the section detail); the Scenarios tab
  lists failing scenarios as scenarios (red outcome), not as a separate findings
  species. Keep the report schema backward-parseable.

**Tests.** A doc-drift claim commits and fails at run with its diagnosis; a
generation-defect claim does NOT commit; a fixed drift flips the same scenario to
pass on the next run untouched; counters reconcile under the new rule; CLI + client
surfaces updated; legacy reports parse.

## 4. Family-level self-healing — diagnose the pattern once, re-author the cluster

STATUS: OPEN

**Problem.** Self-healing is per-claim: each flagged scenario gets one retry with its
own evidence. A run producing many defects (semver: 24, worst case imaginable: 100+)
overwhelms that — yet such bursts are near-always a FEW mistakes repeated (semver's 24
shared one diagnosis). Per-claim loops re-discover the same lesson N times and still
punt the residue to the human via escalation.

**Fix.** After triage, WITHIN the same run:
- Cluster same-family defects: group flagged/defect verdicts by their diagnosis
  similarity (the triage briefs already state the mistake in one sentence; cluster on
  the brief's normalized shape via one cheap LLM call over the list — in: N briefs,
  out: K families with member indexes and a one-sentence shared correction).
- For each family (size >= 3), run ONE family re-author pass: re-author every member
  claim fresh with the SHARED correction + 1-2 exemplar mismatches from the family in
  the prompt — the model fixes the pattern, not each instance blindly. Members then
  re-run birth + fidelity as usual; survivors commit.
- Families that fail again escalate ONCE as a family ("N claims share an authoring
  gap the engine cannot fix: <correction>"), not as N separate items — the human sees
  one line per root cause, never per instance.
- Small clusters (<3) keep today's per-claim path. Cost-bounded: the clustering call
  is O(1) per run; family re-authoring costs what the failed claims would have cost
  to retry individually anyway.

**Tests.** Clustering groups same-brief defects and leaves singletons alone; a family
re-author carries the shared correction + exemplars in each member's prompt; a
converging family commits; a non-converging family escalates as one item with the
member count; counters reconcile.
