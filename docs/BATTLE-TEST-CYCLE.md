# Battle Test Cycle — False Positive Elimination

When battle testing reveals false positives, follow this exact cycle:

## The Cycle

### 1. Battle test
Run **deterministic-only** analysis against the **dealist** project (no LLM rules). Delete all existing analyses first, then trigger a fresh analysis. Verify ALL violations with agents — sample from every rule, check actual source code, report TRUE POSITIVE or FALSE POSITIVE.

### 2. Add to fixtures
For each false positive found:
- Add the **clean pattern** to the **positive** fixture (should NOT trigger)
- Add a **real true positive** for the **same rule** to the **negative** fixture (should trigger)
- Do this for **BOTH JS and Python** fixtures if the rule has visitors in both languages

### 3. Fix the rule
Fix the root cause in the visitor implementation. Not a workaround.

### 4. Review the fix
Run a review agent to verify the fix is proper — no hardcodes, no contortions, no workarounds.

### 5. Run fixture tests
Both positive (zero violations) and negative (all markers detected) must pass.

### 6. Battle test again
Delete all existing analyses in dealist, trigger a fresh analysis, and verify ALL violations again.

### 7. Repeat
Continue the cycle until the verification agent reports **0% false positives** across ALL rules. "Mostly true positive" is not acceptable.

## Rules

- Never skip step 2 (fixtures). Every finding must be captured in fixtures for regression protection.
- Always check BOTH JS and Python when fixing a rule.
- After each fix, run a review agent to check for hardcodes/workarounds.
- The goal is 0% false positives. No exceptions.
- Do NOT commit changes during the cycle. The user will commit when ready.

## Operational Details

### Dealist Project
- **Path:** `/Users/musheghgevorgyan/repos/dealist`
- **Project ID:** `ecde5106-f11c-41c3-8819-f5765ffb7f80`

### API (server must be running via `pnpm dev`)
- **Base URL:** `http://localhost:3001/api/repos`
- **List analyses:** `GET /api/repos/{PROJECT_ID}/analyses`
- **Delete analysis:** `DELETE /api/repos/{PROJECT_ID}/analyses/{ANALYSIS_ID}`
- **Trigger analysis:** `POST /api/repos/{PROJECT_ID}/analyze` (returns 202 with `analysisId`)
- **List violations:** `GET /api/repos/{PROJECT_ID}/violations?analysisId={ANALYSIS_ID}`

### Step-by-step commands
```bash
PROJECT_ID="ecde5106-f11c-41c3-8819-f5765ffb7f80"
BASE="http://localhost:3001/api/repos/$PROJECT_ID"

# 1. List all analyses
curl -s "$BASE/analyses" | jq '.[].id'

# 2. Delete each analysis
curl -s -X DELETE "$BASE/analyses/{ANALYSIS_ID}"

# 3. Trigger fresh deterministic-only analysis
curl -s -X POST "$BASE/analyze" -H "Content-Type: application/json" -d '{"enableLlmRules": false}'

# 4. List violations (after analysis completes)
curl -s "$BASE/violations" | jq '.violations'
```
