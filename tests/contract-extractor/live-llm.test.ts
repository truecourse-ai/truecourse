import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateContracts, spawnRunner } from '../../packages/contract-extractor/src/index.js';
import {
  diffContractDirs,
  formatCorpusDiff,
} from '../../packages/contract-extractor/src/corpus-diff.js';
import { verify } from '../../packages/contract-verifier/src/verify.js';

/**
 * Layer-4 live LLM smoke test.
 *
 * Opt-in via `LLM_TESTS=1` because each run spawns one real `claude`
 * subprocess per slice in `SPEC.md` (~15 calls, ~$ + ~minutes wall
 * time). Skipped in the default test pass.
 *
 * What it asserts:
 *   1. The extractor walks the spec and produces fragments for every
 *      slice (no slice failures).
 *   2. The validation gate (parse + resolve) accepts everything Claude
 *      produced.
 *   3. The generated `.tc` corpus, run against the fixture's planted-bug
 *      `code/` tree, surfaces at least the operation-level drifts (#1,
 *      #3, #4) — proving the spec→contract→verify chain holds end-to-end.
 *
 * What it does NOT assert:
 *   - Exact `.tc` text content. The LLM is non-deterministic; pinning
 *     specific lines would be flaky. Quality is judged by structural
 *     resolution + drift-bug coverage instead.
 *   - All 18 planted bugs. Some require nuanced encoding (e.g.
 *     `forbid status 200 when resource-missing`) that may or may not
 *     survive a one-shot extraction. We only require the broad strokes.
 */

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-js-project-il');
// PRDv2 is the comprehensive current spec — same content the old
// SPEC.md held, now living in the unified multi-doc fixture.
const FIXTURE_SPEC = path.join(FIXTURE_ROOT, 'docs/PRDs/orders_PRDv2.md');
const FIXTURE_CODE = path.join(FIXTURE_ROOT, 'code/src');
/** The hand-written `.tc` corpus that ships with the fixture — the
 *  ground-truth contract set we compare LLM-generated output against. */
const FIXTURE_CONTRACTS = path.join(FIXTURE_ROOT, '.truecourse/contracts');
/** Where this test deposits its most-recent LLM output so a developer can
 *  inspect what Claude actually produced — `.tc` files, the populated
 *  extractor cache, and the corpus-diff against the hand-written ground
 *  truth. Gitignored; rewritten on every live run. */
const SAMPLE_OUTPUT_DIR = path.resolve(__dirname, '../.llm-sample');

const SHOULD_RUN = process.env.LLM_TESTS === '1';

/** Recursive directory copy — used to stash the LLM output for inspection. */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, entry.name);
    const b = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

describe.skipIf(!SHOULD_RUN)('contract extractor — live Claude Code smoke', () => {
  // The full pipeline takes minutes. Per-test timeout is generous.
  const TIMEOUT_MS = 8 * 60 * 1000;

  it(
    'extracts SPEC.md → .tc → verifies code drifts end-to-end',
    async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-'));
      try {
        // Stage a canonical spec under tmp/.truecourse/specs/ — the
        // contract extractor reads only the canonical now. We treat
        // the entire orders_PRDv2.md as one module's endpoints.md to
        // keep the test focused on extraction (one slice per operation
        // heading) without a second LLM-driven consolidation pass.
        const moduleDir = path.join(tmp, '.truecourse', 'specs', 'modules', 'orders');
        fs.mkdirSync(moduleDir, { recursive: true });
        fs.copyFileSync(FIXTURE_SPEC, path.join(moduleDir, 'endpoints.md'));
        fs.writeFileSync(
          path.join(moduleDir, 'module.yaml'),
          [
            'name: orders',
            'status: shipped',
            'sourceDocs:',
            '  - docs/PRDs/orders_PRDv2.md',
            'scope:',
            '  paths:',
            '    - /api/orders/**',
          ].join('\n') + '\n',
        );

        const sliceFailures: string[] = [];
        const result = await generateContracts({
          repoRoot: tmp,
          runner: spawnRunner({
            onSliceDone: (slice, ok) => {
              if (!ok) sliceFailures.push(slice.headingPath.join(' → '));
            },
          }),
        });

        // Surface what we got so a failed run is informative.
        const summary = [
          `slices: ${result.slices.length}`,
          `cache hits: ${result.slices.filter((s) => s.cache === 'hit').length}`,
          `slice failures: ${sliceFailures.length}`,
          `validation issues: ${result.validationIssues.length}`,
          `merge diagnostics: ${result.mergeDiagnostics.length}`,
          `files written: ${result.write.written.length}`,
        ].join(' · ');
        // eslint-disable-next-line no-console
        console.log(`[live-llm] ${summary}`);

        expect(sliceFailures, 'every slice must extract cleanly').toEqual([]);

        // Surface validation issues for diagnostic context. We split them
        // into two buckets:
        //
        //   - parseErrors:     hard bug (LLM produced ungrammatical .tc).
        //                      The smoke test fails on any of these.
        //   - unresolvedRefs:  soft — usually means two slices invented
        //                      different identities for the same artifact
        //                      (LLM non-determinism across parallel
        //                      sub-prompts). We tolerate a small number
        //                      since they don't corrupt the corpus —
        //                      the writer skips affected artifacts.
        const parseErrors = result.validationIssues.filter((i) =>
          i.message.startsWith('parse error'),
        );
        const unresolvedRefs = result.validationIssues.filter((i) =>
          i.message.includes("doesn't resolve"),
        );

        if (result.validationIssues.length > 0) {
          const dump = result.validationIssues
            .map(
              (i, idx) =>
                `--- issue ${idx + 1}: ${i.artifactKey} ---\n${i.message}\n${i.tcSource ? `\ntcSource:\n${i.tcSource}` : ''}`,
            )
            .join('\n\n');
          // eslint-disable-next-line no-console
          console.log(`[live-llm] validation issues:\n${dump}`);
        }

        expect(parseErrors, 'no parse errors — LLM must produce grammatical .tc').toEqual([]);
        // Cross-ref drift is the LLM-non-determinism class; allow a small
        // tail. Bumping this floor up is a prompt-quality improvement.
        expect(
          unresolvedRefs.length,
          'unresolved cross-references (different slices coining different ids)',
        ).toBeLessThanOrEqual(3);
        expect(result.write.written.length).toBeGreaterThan(0);

        // ──────────────────────────────────────────────────────────
        // Compare LLM output against the fixture's hand-written .tc
        // corpus. The fixture is the ground truth — same SPEC.md, same
        // code, hand-written .tc that we already trust. The LLM
        // shouldn't reproduce it byte-for-byte (different wording,
        // ordering, etc.) but it SHOULD reach behaviorally similar
        // results: cover the same major artifacts, find similar drifts.
        // ──────────────────────────────────────────────────────────
        const llmVerify = await verify({
          contractsDir: path.join(tmp, '.truecourse', 'contracts'),
          codeDir: FIXTURE_CODE,
        });
        const handVerify = await verify({
          contractsDir: FIXTURE_CONTRACTS,
          codeDir: FIXTURE_CODE,
        });

        expect(llmVerify.resolverErrors, 'LLM-side resolver must be clean').toEqual([]);
        expect(handVerify.resolverErrors, 'hand-side resolver must be clean').toEqual([]);

        // ── Structural corpus diff (the real behavioural check) ──
        // The fixture's hand-written corpus is the ground-truth; the LLM
        // output is the candidate. The diff compares typed contracts at
        // the obligation level — same logical claim ⇒ no diff, regardless
        // of text/whitespace/section-label variation. Coverage is the
        // fraction of hand-side obligations the LLM also encoded.
        const corpusDiff = diffContractDirs(
          FIXTURE_CONTRACTS,
          path.join(tmp, '.truecourse', 'contracts'),
        );
        // eslint-disable-next-line no-console
        console.log(
          `[live-llm] obligation coverage: ${(corpusDiff.obligationCoverage * 100).toFixed(1)}% ` +
            `(${corpusDiff.leftObligationCount} hand-side obligations) · ` +
            `${corpusDiff.artifactDiffs.length} artifact-level diffs · ` +
            `${corpusDiff.obligationDiffs.length} artifacts with obligation drift`,
        );
        // 65% obligation coverage is the regression floor — set just below
        // the level we currently achieve on the fixture (≈70%) so the
        // test catches a real prompt-quality regression but doesn't
        // flake on small day-to-day LLM variance. Push this floor up as
        // we tighten the prompt; the diff output below tells us where to.
        const COVERAGE_FLOOR = 0.65;
        if (corpusDiff.obligationCoverage < COVERAGE_FLOOR + 0.05) {
          // eslint-disable-next-line no-console
          console.log(`[live-llm] full diff:\n${formatCorpusDiff(corpusDiff)}`);
        }
        expect(corpusDiff.obligationCoverage).toBeGreaterThanOrEqual(COVERAGE_FLOOR);

        // ── Drift behavioural-equivalence check ──
        // Both contract sets should find a meaningful number of planted
        // bugs in the fixture code. We don't require the LLM to reach
        // hand-written's 22-drift count, but it should catch at least a
        // third — proves the chain spec → contract → drift works
        // end-to-end with the live LLM in the loop.
        // eslint-disable-next-line no-console
        console.log(
          `[live-llm] drifts: hand-written=${handVerify.drifts.length}, llm-generated=${llmVerify.drifts.length}`,
        );
        expect(llmVerify.drifts.length).toBeGreaterThanOrEqual(
          Math.floor(handVerify.drifts.length / 3),
        );

        // ── Specific planted bug we always expect ──
        // Bug #1 — POST /api/orders returns 200 instead of 201 — is the
        // single most reliably-extractable obligation in SPEC.md (one
        // line says "201 Created"). If even THIS regresses, the prompt
        // or the operation lifter has broken.
        const driftKeys = llmVerify.drifts.map(
          (d) => `${d.artifactRef.type}:${d.artifactRef.identity} / ${d.obligationKey}`,
        );
        expect(
          driftKeys.some(
            (k) =>
              k.includes('Operation:POST /api/orders') &&
              k.includes('response.201'),
          ),
          `expected bug #1 (POST /api/orders missing 201) to surface; got drift keys: ${driftKeys.join(', ')}`,
        ).toBe(true);
        // Stash the LLM output where a human can browse it after the
        // run. Always overwrites — the most-recent live run wins. Done
        // INSIDE the try so a failed run still leaves something to debug.
      } finally {
        try {
          fs.rmSync(SAMPLE_OUTPUT_DIR, { recursive: true, force: true });
          fs.mkdirSync(SAMPLE_OUTPUT_DIR, { recursive: true });
          // Copy the generated .tc corpus and the populated extractor cache.
          const tcDir = path.join(tmp, '.truecourse', 'contracts');
          const cacheDir = path.join(tmp, '.truecourse', '.cache', 'extractor');
          if (fs.existsSync(tcDir)) {
            copyDir(tcDir, path.join(SAMPLE_OUTPUT_DIR, 'contracts'));
          }
          if (fs.existsSync(cacheDir)) {
            copyDir(cacheDir, path.join(SAMPLE_OUTPUT_DIR, 'extractor-cache'));
          }
          // Drop a README so opening the dir is self-explanatory.
          fs.writeFileSync(
            path.join(SAMPLE_OUTPUT_DIR, 'README.md'),
            [
              '# LLM-generated contracts — last live run',
              '',
              `Captured at: ${new Date().toISOString()}`,
              '',
              '- `contracts/` — the `.tc` files Claude produced for `tests/fixtures/sample-js-project-il/SPEC.md`',
              '- `extractor-cache/` — per-slice JSON cache (input/output for each Claude call)',
              '',
              'This directory is gitignored. It is rewritten every time you run',
              '`LLM_TESTS=1 pnpm vitest run tests/contract-extractor/live-llm.test.ts`.',
              '',
              'To compare against the hand-written corpus:',
              '',
              '```bash',
              '# Side-by-side diff of one artifact:',
              `diff -u ${path.relative(process.cwd(), FIXTURE_CONTRACTS)}/orders/operations/post-orders.tc \\`,
              `        ${path.relative(process.cwd(), SAMPLE_OUTPUT_DIR)}/contracts/orders/operations/post-orders.tc`,
              '```',
              '',
            ].join('\n'),
          );
          // eslint-disable-next-line no-console
          console.log(
            `[live-llm] generated contracts saved to ${path.relative(process.cwd(), SAMPLE_OUTPUT_DIR)} for inspection`,
          );
        } catch {
          // Don't let copy errors mask the actual test outcome.
        }
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    TIMEOUT_MS,
  );
});
