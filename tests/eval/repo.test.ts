import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  defaultConcurrency,
  diffContractDirs,
  formatCorpusDiff,
  gatherCandidates,
  generateContracts,
  proposeWithHeuristic,
  spawnRunner,
  writeSpecsConfig,
  type GenerateResult,
} from '../../packages/contract-extractor/src/index.js';
import { verify, type VerifyResult } from '../../packages/contract-verifier/src/verify.js';

/**
 * Eval harness — driven by env vars, runs only when `EVAL_TARGET` is set.
 *
 *   EVAL_TARGET=<git-url-or-local-path> pnpm vitest run tests/eval/repo.test.ts
 *
 * Optional env:
 *   EVAL_NO_LLM=1               skip extraction (verify only)
 *   EVAL_MAX_SLICES=<n>          cap LLM calls during extraction
 *   EVAL_GOLDEN=<path>           diff against an existing .tc corpus
 *
 * Output:
 *   tests/.eval-repos/<slug>/    cloned repo (gitignored)
 *   tests/.eval-reports/<slug>.md  markdown report (gitignored)
 *
 * Cost: one `claude -p` subprocess per slice on the first run; subsequent
 * runs hit the extractor cache and cost ≈ $0. Use `EVAL_MAX_SLICES=5`
 * when scoping a new repo for the first time.
 *
 * Why a vitest test rather than a tsx script: vitest's resolver follows
 * workspace `src/*.ts` symlinks across packages, which tsx's doesn't.
 * The "test" is really an integration runner — it's expected to take
 * minutes and write artifacts to disk; it does not assert correctness.
 */

const EVAL_TARGET = process.env.EVAL_TARGET;
const EVAL_NO_LLM = process.env.EVAL_NO_LLM === '1';
const EVAL_MAX_SLICES = process.env.EVAL_MAX_SLICES ? parseInt(process.env.EVAL_MAX_SLICES, 10) : undefined;
const EVAL_GOLDEN = process.env.EVAL_GOLDEN;
/**
 * Override the code directory the verifier walks. Relative paths are
 * resolved against the repo root. Use when the repo's backend lives
 * somewhere other than the auto-detect can find (e.g. monorepos
 * with `backend/`, `services/api/`, etc.).
 */
const EVAL_CODE = process.env.EVAL_CODE;

const REPO_ROOT = path.resolve(__dirname, '../..');
const REPOS_DIR = path.join(REPO_ROOT, 'tests/.eval-repos');
const REPORTS_DIR = path.join(REPO_ROOT, 'tests/.eval-reports');

describe.skipIf(!EVAL_TARGET)('eval harness', () => {
  // Real git clones + (optional) live LLM calls — minutes, not seconds.
  const TIMEOUT_MS = 30 * 60 * 1000;

  it(
    'runs extract + verify against the target repo, writes a report',
    async () => {
      fs.mkdirSync(REPOS_DIR, { recursive: true });
      fs.mkdirSync(REPORTS_DIR, { recursive: true });

      const { repoPath, slug, source } = resolveTarget(EVAL_TARGET!);
      // eslint-disable-next-line no-console
      console.log(`[eval] ${slug}  (${source})`);

      const commitHash = readCommit(repoPath);

      // ---- Bootstrap specs.yaml if missing (heuristic, no LLM call) ----
      const specsYaml = path.join(repoPath, '.truecourse/specs.yaml');
      let specsBootstrapped = false;
      if (!fs.existsSync(specsYaml)) {
        const candidates = gatherCandidates(repoPath);
        const proposal = proposeWithHeuristic(candidates);
        if (proposal.config.specs.length === 0) {
          writeReport({ slug, source, commitHash, repoPath, skipReason: 'no specs detected' });
          // eslint-disable-next-line no-console
          console.log('[eval] no specs detected — skipped');
          return;
        }
        writeSpecsConfig(repoPath, proposal.config);
        specsBootstrapped = true;
        // eslint-disable-next-line no-console
        console.log(`[eval] wrote .truecourse/specs.yaml (${proposal.config.specs.length} entries)`);
      }

      // ---- Run extraction (unless EVAL_NO_LLM=1) ----
      let extract: GenerateResult | null = null;
      let extractTimeMs = 0;
      if (!EVAL_NO_LLM) {
        const t0 = performance.now();
        let runner = spawnRunner({
          concurrency: defaultConcurrency(),
          onSliceStart: (s) => {
            // eslint-disable-next-line no-console
            console.log(`[eval] · ${s.specPath} :: ${s.headingPath.join(' → ')}`);
          },
        });
        if (EVAL_MAX_SLICES !== undefined) {
          const cap = EVAL_MAX_SLICES;
          const inner = runner;
          runner = async (slices) => inner(slices.slice(0, cap));
        }
        extract = await generateContracts({ repoRoot: repoPath, runner });
        extractTimeMs = performance.now() - t0;
        // eslint-disable-next-line no-console
        console.log(
          `[eval] extract: ${extract.slices.length} slices ` +
            `(${extract.slices.filter((s) => s.cache === 'hit').length} cache hits) ` +
            `→ ${extract.write.written.length} files written, ` +
            `${extract.validationIssues.length} validation issues`,
        );
      }

      // ---- Run verification — needs .tc to exist ----
      const contractsDir = path.join(repoPath, '.truecourse/contracts');
      let verifyResult: VerifyResult | null = null;
      let verifyTimeMs = 0;
      if (fs.existsSync(contractsDir)) {
        const codeDir = EVAL_CODE
          ? path.resolve(repoPath, EVAL_CODE)
          : autoDetectCodeDir(repoPath);
        const t0 = performance.now();
        try {
          verifyResult = await verify({ contractsDir, codeDir });
          verifyTimeMs = performance.now() - t0;
          // eslint-disable-next-line no-console
          console.log(
            `[eval] verify: ${verifyResult.drifts.length} drifts on ${verifyResult.extractedOperationCount} operations`,
          );
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[eval] verify crashed: ${e instanceof Error ? e.message : e}`);
        }
      }

      // ---- Optional structural diff against a golden corpus ----
      let corpusDiffText: string | null = null;
      if (EVAL_GOLDEN && fs.existsSync(contractsDir)) {
        const diff = diffContractDirs(EVAL_GOLDEN, contractsDir);
        corpusDiffText = formatCorpusDiff(diff);
        // eslint-disable-next-line no-console
        console.log(
          `[eval] corpus diff: ${(diff.obligationCoverage * 100).toFixed(1)}% obligation coverage`,
        );
      }

      // ---- Write the report ----
      const reportPath = writeReport({
        slug,
        source,
        commitHash,
        repoPath,
        specsBootstrapped,
        extract,
        extractTimeMs,
        verifyResult,
        verifyTimeMs,
        corpusDiffText,
      });
      // eslint-disable-next-line no-console
      console.log(`[eval] report → ${path.relative(REPO_ROOT, reportPath)}`);

      // The harness doesn't assert correctness — the report is the
      // artifact. Just confirm it landed on disk.
      expect(fs.existsSync(reportPath)).toBe(true);
    },
    TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Repo resolution — accept either a git URL or a local path.
// ---------------------------------------------------------------------------

interface Resolved {
  repoPath: string;
  slug: string;
  source: string;     // human-readable origin (URL or absolute path)
}

function resolveTarget(target: string): Resolved {
  if (looksLikeGitUrl(target)) return cloneOrPull(target);
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`Path doesn't exist: ${abs}`);

  // Local target — copy into tests/.eval-repos/ so the harness never
  // mutates the user's working tree (it writes the consolidator/
  // extractor caches and contracts under <root>/.truecourse/). Skip
  // node_modules / .git / dist to keep the copy fast and small.
  const slug = path.basename(abs).toLowerCase().replace(/[^a-z0-9-]+/g, '-') + '-local';
  const dest = path.join(REPOS_DIR, slug);
  if (!fs.existsSync(dest)) {
    // eslint-disable-next-line no-console
    console.log(`[eval] copying local target → ${path.relative(REPO_ROOT, dest)}`);
    copyDirFiltered(abs, dest, EXCLUDED_DIRS);
  }
  return { repoPath: dest, slug, source: abs };
}

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '.turbo']);

function copyDirFiltered(src: string, dest: string, excluded: Set<string>): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const a = path.join(src, entry.name);
    const b = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirFiltered(a, b, excluded);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

function looksLikeGitUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(s) || s.endsWith('.git');
}

function cloneOrPull(url: string): Resolved {
  const slug = url.replace(/\.git$/, '').split('/').slice(-2).join('-')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const dest = path.join(REPOS_DIR, slug);
  if (!fs.existsSync(dest)) {
    // eslint-disable-next-line no-console
    console.log(`[eval] cloning ${url}`);
    spawnSync('git', ['clone', '--depth', '1', url, dest], { stdio: 'inherit' });
  }
  return { repoPath: dest, slug, source: url };
}

function readCommit(repoPath: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function autoDetectCodeDir(repoPath: string): string {
  // Prefer src/, then a small set of common service dir names; fall back
  // to the repo root if none match.
  const candidates = ['src', 'app', 'apps', 'server', 'lib', 'packages'];
  for (const c of candidates) {
    const full = path.join(repoPath, c);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
  }
  return repoPath;
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

interface ReportInput {
  slug: string;
  source: string;
  commitHash: string | null;
  repoPath: string;
  specsBootstrapped?: boolean;
  skipReason?: string;
  extract?: GenerateResult | null;
  extractTimeMs?: number;
  verifyResult?: VerifyResult | null;
  verifyTimeMs?: number;
  corpusDiffText?: string | null;
}

function writeReport(input: ReportInput): string {
  const out = path.join(REPORTS_DIR, `${input.slug}.md`);
  const lines: string[] = [];
  lines.push(`# Eval — ${input.slug}`);
  lines.push('');
  lines.push(`- **Source**: \`${input.source}\``);
  if (input.commitHash) lines.push(`- **Commit**: \`${input.commitHash.slice(0, 12)}\``);
  lines.push(`- **When**: ${new Date().toISOString()}`);
  lines.push('');

  if (input.skipReason) {
    lines.push(`> Skipped: ${input.skipReason}`);
    lines.push('');
    fs.writeFileSync(out, lines.join('\n'));
    return out;
  }

  // Extraction
  lines.push('## Extraction');
  if (!input.extract) {
    lines.push('- skipped (`EVAL_NO_LLM=1`)');
  } else {
    const x = input.extract;
    const slicesByCache = {
      hit: x.slices.filter((s) => s.cache === 'hit').length,
      miss: x.slices.filter((s) => s.cache === 'miss').length,
    };
    const failedSlices = x.slices.filter((s) => s.cache === 'miss' && s.run && !s.run.result);
    lines.push(`- **Slices**: ${x.slices.length} total · ${slicesByCache.hit} cache hits · ${slicesByCache.miss} fresh LLM calls`);
    if (failedSlices.length > 0) {
      lines.push(`- **Slice failures**: ${failedSlices.length}`);
      for (const f of failedSlices) {
        const heading = f.slice.headingPath.join(' / ') || '(root)';
        const err = f.run?.error ? oneLine(f.run.error) : '(no error message)';
        lines.push(`  - \`${heading}\`: ${err}`);
      }
    }
    lines.push(`- **Wall time**: ${(input.extractTimeMs! / 1000).toFixed(1)}s`);
    lines.push(`- **Files written**: ${x.write.written.length}`);
    if (x.validationIssues.length > 0) {
      const hard = x.validationIssues.filter((i) => i.severity === 'hard').length;
      const soft = x.validationIssues.filter((i) => i.severity === 'soft').length;
      lines.push(`- **Validation issues**: ${x.validationIssues.length} (${hard} hard / ${soft} soft)`);
      lines.push('');
      lines.push('  Top 10:');
      for (const issue of x.validationIssues.slice(0, 10)) {
        lines.push(`  - \`${issue.severity}\` ${issue.artifactKey}: ${oneLine(issue.message)}`);
      }
    }
    if (x.mergeDiagnostics.length > 0) {
      lines.push(`- **Merge diagnostics**: ${x.mergeDiagnostics.length}`);
    }
  }
  lines.push('');

  // Verification
  lines.push('## Verification');
  if (!input.verifyResult) {
    lines.push('- skipped (no `.truecourse/contracts/` produced)');
  } else {
    const v = input.verifyResult;
    lines.push(`- **Artifacts indexed**: ${v.artifactCount}`);
    lines.push(`- **Operations extracted (code-side)**: ${v.extractedOperationCount}`);
    lines.push(`- **Drifts**: ${v.drifts.length}`);
    lines.push(`- **Resolver errors**: ${v.resolverErrors.length}`);
    lines.push(`- **Unresolved cross-refs**: ${v.unresolvedRefs.length}`);
    lines.push(`- **Wall time**: ${(input.verifyTimeMs! / 1000).toFixed(2)}s`);

    if (v.drifts.length > 0) {
      const byKind = new Map<string, number>();
      for (const d of v.drifts) byKind.set(d.artifactRef.type, (byKind.get(d.artifactRef.type) ?? 0) + 1);
      lines.push('');
      lines.push('  Drifts by artifact kind:');
      for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  - ${kind}: ${count}`);
      }
      lines.push('');
      lines.push('  Top 10 drifts:');
      for (const d of v.drifts.slice(0, 10)) {
        lines.push(`  - **${d.severity}** \`${d.artifactRef.type}:${d.artifactRef.identity}\` — ${d.obligationKey}`);
        lines.push(`    ${oneLine(d.message)}`);
      }
    }
  }
  lines.push('');

  if (input.corpusDiffText) {
    lines.push('## Corpus diff vs golden');
    lines.push('');
    lines.push('```');
    lines.push(input.corpusDiffText);
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push(`Generated by \`tests/eval/repo.test.ts\` against \`${input.repoPath}\`.`);
  if (input.specsBootstrapped) {
    lines.push('Note: this run wrote `.truecourse/specs.yaml` via the deterministic heuristic.');
  }

  fs.writeFileSync(out, lines.join('\n'));
  return out;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
