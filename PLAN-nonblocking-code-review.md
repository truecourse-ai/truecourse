# Non-Blocking Code Review + Incremental File Analysis

## Context

Code review (LLM code analysis - Flow 3) is the slowest part of analysis (3-10 min). Currently all 3 violation flows must finish before any results are shown. This blocks the user from seeing service/module/database violations that are ready much sooner. Additionally, every analysis reviews ALL files even if only a few changed.

**Goal:** Show architecture violations immediately, run code review in background, and only review changed files on subsequent analyses.

## Current Flow

```
POST /analyze → 202
  → registerAnalysis(id) — AbortController for cancellation
  → runAnalysis() (structural)
  → runViolationPipeline():
      Promise.allSettled([
        FLOW 1: deterministic enrichment (fast),
        FLOW 2: LLM rule analysis (moderate),
        FLOW 3: LLM code analysis (SLOW - 3-10min)
      ])
      → persist ALL violations
  → emit violations:ready
  → emit analysis:complete
  → finally: unregisterAnalysis(id)
```

## New Flow

```
POST /analyze → 202
  → registerAnalysis(id)
  → runAnalysis() (structural)
  → get commit hash, compute changed files since last analysis
  → runViolationPipeline() [MODIFIED - only waits for flows 1+2]:
      Start all 3 flows in parallel
      await Promise.allSettled([FLOW 1, FLOW 2])  ← only wait for 1+2
      persist architecture violations + deterministic code violations
      return { codeReviewPromise }  ← handle for in-flight flow 3
  → emit violations:ready
  → emit analysis:complete          ← user sees results NOW
  → fire-and-forget: codeReviewPromise
      → check abort signal, await LLM code batches
      → persist LLM code violations
      → flush usage, emit code-review:ready
      → finally: unregisterAnalysis(id)  ← deferred cleanup
```

---

## Implementation Steps

### Step 1: Schema — Add `commitHash` to `analyses` table

**File:** `apps/server/src/db/schema.ts`
- Add `commitHash: text('commit_hash')` to analyses table
- Run `pnpm db:generate` to create migration

### Step 2: New Socket Events

**File:** `apps/server/src/socket/handlers.ts`
- Add `activeCodeReviews` map (like `activeAnalyses`) for late-joining clients
- Add `emitCodeReviewProgress(repoId, progress)` → emits `code-review:progress`
- Add `emitCodeReviewReady(repoId, analysisId)` → emits `code-review:ready`
- In `joinRepo` handler, also send active code review status to late joiners

### Step 3: Split Violation Pipeline

**File:** `apps/server/src/services/violation-pipeline.service.ts`

This is the core change:

1. **Extract code violation persistence** (lines ~778-882) into a helper function `persistCodeViolations()` that takes the intermediate state as params
2. **Change `Promise.allSettled`** at line 747: only await flows 1+2 (`[deterministicPromise, llmRulePromise]`)
3. **Persist deterministic code violations synchronously** (unchanged-file carry-forward still happens here)
4. **Return `codeReviewPromise`** — an async closure that:
   - Awaits `llmCodePromise` (already started, running in parallel)
   - Calls `processLlmCodeViolations()`
   - Persists LLM code violations (the extracted helper)
   - Checks `signal?.aborted` before heavy work to respect cancellation

Update `ViolationPipelineResult` (line 107):
```ts
export interface ViolationPipelineResult {
  serviceDescriptions: { id: string; description: string }[];
  newViolations?: DiffViolationItem[];
  resolvedViolationIds?: string[];
  codeViolations: CodeViolation[];       // deterministic code violations (available immediately)
  codeResolvedCount: number;
  codeReviewPromise: Promise<void> | null; // NEW: background LLM code review handle
}
```

### Step 4: Analysis Route — Orchestrate Split + Incremental

**File:** `apps/server/src/routes/analysis.ts`

**Commit hash capture:**
- After detecting branch (line 75), get `commitHash = (await git.revparse(['HEAD'])).trim()`
- Store it in the `db.insert(analyses)` call

**Incremental file detection:**
- Before calling `runViolationPipeline`, query the previous analysis's `commitHash`
- If it exists, run `git.diff([prevHash, 'HEAD', '--name-only'])` to get changed files
- Pass as `changedFileSet` into the pipeline (already an accepted param at line 98)
- First analysis (no previous commit hash) → reviews all files

**Fire-and-forget code review + deferred cleanup:**

The current `finally` block (line 348) calls `unregisterAnalysis(id)`. With background code review, we need to defer this:

```ts
const pipelineResult = await runViolationPipeline({...});
emitViolationsReady(id, analysis.id);
await provider.flushUsage();  // flush flows 1+2 usage
emitAnalysisComplete(id, analysis.id);

if (pipelineResult.codeReviewPromise) {
  // Don't unregister yet — code review still running
  pipelineResult.codeReviewPromise
    .then(() => provider.flushUsage())
    .then(() => emitCodeReviewReady(id, analysis.id))
    .catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log(`[CodeReview] Cancelled for repo ${id}`);
      } else {
        console.error(`[CodeReview] Failed for repo ${id}:`, err);
      }
      emitCodeReviewReady(id, analysis.id); // don't hang UI
    })
    .finally(() => unregisterAnalysis(id));
} else {
  unregisterAnalysis(id);
}
```

Remove `unregisterAnalysis(id)` from the existing `finally` block — it's now handled above. Keep `unregisterAnalysis` in the error/cancel paths that exit early (before code review starts).

**Cancel behavior:** When cancel is triggered during code review, the abort signal propagates to the LLM provider. The code review promise catches the AbortError and emits `code-review:ready` so the UI doesn't hang.

### Step 5: Frontend — useSocket Hook

**File:** `apps/web/src/hooks/useSocket.ts`
- Add `code-review:progress` and `code-review:ready` socket listeners
- Expose `codeReviewProgress` state (like `analysisProgress`)
- Forward events through `onEvent` handler map

### Step 6: Frontend — RepoGraphPage State

**File:** `apps/web/src/components/pages/RepoGraphPage.tsx`
- Add `isCodeReviewing` state
- On `analysis:complete`: set `isCodeReviewing = true`
- On `code-review:ready`: set `isCodeReviewing = false`, call `refetchViolations()` and `refetchCodeViolationSummary()`
- Pass `isCodeReviewing` to `LeftSidebar`

### Step 7: Frontend — LeftSidebar Indicator

**File:** `apps/web/src/components/layout/LeftSidebar.tsx`

The sidebar uses a `badgeCounts` prop with `number | { newCount, resolvedCount }` format, and lucide-react icons.

- Accept `isCodeReviewing?: boolean` prop
- On the `files` tab icon, when `isCodeReviewing` is true, render a small `Loader2` spinner from lucide-react (already used in the project) overlaid on the icon:
```tsx
{tab.id === 'files' && isCodeReviewing && (
  <Loader2 className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-spin text-primary" />
)}
```

### Step 8: CLI — Non-blocking Finish

**File:** `tools/cli/src/commands/analyze.ts`
- Both `violations:ready` and `analysis:complete` fire before code review now, so CLI finishes promptly — no structural changes needed
- After showing violations summary, add: `p.log.info("Code review running in background — results will appear in the dashboard")`

### Step 9: Edge Cases

- **Cancellation during code review:** AbortSignal propagates to LLM provider. Code review promise catches AbortError, emits `code-review:ready`, calls `unregisterAnalysis`
- **Late-joining clients:** `activeCodeReviews` map in socket handlers ensures they get status
- **New analysis while code review runs:** `registerAnalysis` already aborts previous analysis's AbortController (line 18 of analysis-registry.ts), so the old code review will get cancelled via signal
- **`violations:ready` semantics:** Now means "architecture + deterministic code violations ready." LLM code violations arrive on `code-review:ready`. The existing `refetchCodeViolationSummary()` call on `violations:ready` shows deterministic code violations; the `code-review:ready` handler adds LLM ones

---

## Critical Files

| File | Change |
|------|--------|
| `apps/server/src/db/schema.ts` | Add `commitHash` column |
| `apps/server/src/socket/handlers.ts` | New emit functions + `activeCodeReviews` tracking |
| `apps/server/src/services/violation-pipeline.service.ts` | Split pipeline, extract code persistence |
| `apps/server/src/routes/analysis.ts` | Commit hash, incremental diff, fire-and-forget, deferred unregister |
| `apps/web/src/hooks/useSocket.ts` | New event listeners |
| `apps/web/src/components/pages/RepoGraphPage.tsx` | `isCodeReviewing` state |
| `apps/web/src/components/layout/LeftSidebar.tsx` | Spinner indicator on files tab |
| `tools/cli/src/commands/analyze.ts` | Info message |

## Verification

1. **Build:** `pnpm build` should pass
2. **Migration:** `pnpm db:generate` creates clean migration, server applies it on restart
3. **First analysis:** All files reviewed, commit hash stored, violations appear in two waves (architecture immediately, code violations after)
4. **Second analysis:** Only changed files reviewed (verify via server logs showing fewer files in code batches)
5. **UI:** Spinner visible on files tab during background review, disappears when `code-review:ready` fires
6. **CLI:** Finishes after architecture violations, prints background review message
7. **Page refresh mid-review:** Reconnecting client sees code review in-progress indicator
8. **Cancel during code review:** Code review aborts cleanly, `code-review:ready` still emits, analysis unregisters
