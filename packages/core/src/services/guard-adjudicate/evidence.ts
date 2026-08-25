/**
 * THE EVIDENCE DIGEST — the compact rendering of one failure's evidence bundle
 * (`guard/evidence/<runId>/<scenarioId>/`) that opens the adjudication
 * briefing. The bundle is the runner's full record (invocation.json per-step
 * records, raw + normalized streams, diff.txt, files.txt, transcript.txt,
 * screenshots); a session gets the DIGEST up front — the step table, the
 * mismatch, the focus streams head-truncated — and pages the rest through
 * `read_evidence` only where the digest raises a question.
 *
 * Every read goes through the guard store's dir-confined evidence readers, so
 * the digest can never read outside the evidence root — the same containment
 * `read_evidence` itself enforces.
 */

import { z } from 'zod';
import { listGuardEvidenceAt, readGuardEvidenceAt } from '../../lib/guard-store.js';

/** Head-truncation caps for what the digest inlines. */
const DIGEST_STREAM_CHARS = 1500;
const DIGEST_DIFF_CHARS = 3000;
const DIGEST_STEP_EXCERPT_CHARS = 240;

/**
 * The slice of an `invocation.json` step record the digest renders — read
 * TOLERANTLY (`.passthrough()`, everything optional): the bundle format has
 * grown fields over time and a digest must render an old bundle, not refuse it.
 */
const InvocationStepShape = z
  .object({
    index: z.number().int(),
    kind: z.string().optional(),
    argv: z.array(z.string()).optional(),
    exitCode: z.number().nullable().optional(),
    timedOut: z.boolean().optional(),
    spawnError: z.string().optional(),
    durationMs: z.number().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    web: z
      .object({ command: z.string().optional(), url: z.string().optional(), screenshot: z.string().optional(), expectation: z.string().optional() })
      .passthrough()
      .optional(),
    api: z
      .object({ command: z.string().optional(), status: z.number().nullable().optional(), requestError: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const InvocationShape = z
  .object({ steps: z.array(InvocationStepShape).default([]) })
  .passthrough();

export type InvocationStep = z.infer<typeof InvocationStepShape>;

/** Parse a bundle's `invocation.json`, or `null` (absent / unreadable / old shape). */
export async function readInvocation(
  repoRoot: string,
  evidenceDir: string,
): Promise<z.infer<typeof InvocationShape> | null> {
  const raw = await readGuardEvidenceAt(repoRoot, evidenceDir, 'invocation.json');
  if (raw === null) return null;
  try {
    const parsed = InvocationShape.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One compact line per executed step — the digest's step table. */
function stepLine(step: InvocationStep, failingStep: number | undefined): string {
  const marks = step.index === failingStep ? '  ← FAILING' : '';
  let what: string;
  if (step.web) {
    what = `web  ${step.web.command ?? ''}  @ ${step.web.url ?? '?'}${step.web.screenshot ? `  [${step.web.screenshot}]` : ''}`;
  } else if (step.api) {
    what = `api  ${step.api.command ?? ''}  → ${step.api.status ?? '(no response)'}${step.api.requestError ? `  (${step.api.requestError})` : ''}`;
  } else {
    const exit = step.spawnError
      ? `spawn error: ${step.spawnError}`
      : `exit ${step.exitCode ?? '(killed)'}${step.timedOut ? ' [timed out]' : ''}`;
    what = `${step.kind ?? 'run'}  ${JSON.stringify(step.argv ?? [])}  ${exit}`;
  }
  const excerpt =
    step.index === failingStep && (step.stdout || step.stderr)
      ? `\n     out: ${clip(step.stdout ?? '', DIGEST_STEP_EXCERPT_CHARS)}\n     err: ${clip(step.stderr ?? '', DIGEST_STEP_EXCERPT_CHARS)}`
      : '';
  return `  ${step.index}. ${what}${marks}${excerpt}`;
}

/**
 * Render the digest, or an honest note when the bundle is gone (evidence is
 * gitignored — a cloner's board points at bundles only the running tree had).
 */
export async function buildEvidenceDigest(
  repoRoot: string,
  evidenceDir: string | undefined,
  failingStep: number | undefined,
): Promise<{ digest: string; files: string[] }> {
  if (!evidenceDir) {
    return { digest: '(this row carries no evidence pointer — adjudicate from the board facts and reruns)', files: [] };
  }
  const files = await listGuardEvidenceAt(repoRoot, evidenceDir);
  if (files.length === 0) {
    return {
      digest: `(the evidence bundle at ${evidenceDir} is not on this machine — it is gitignored and lives where the run happened)`,
      files: [],
    };
  }
  const lines: string[] = [];

  const invocation = await readInvocation(repoRoot, evidenceDir);
  if (invocation && invocation.steps.length > 0) {
    lines.push('### Step table (invocation.json, condensed)');
    for (const step of invocation.steps) lines.push(stepLine(step, failingStep));
    lines.push('');
  }

  const diff = await readGuardEvidenceAt(repoRoot, evidenceDir, 'diff.txt');
  if (diff) {
    lines.push('### diff.txt');
    lines.push(clip(diff.trimEnd(), DIGEST_DIFF_CHARS));
    lines.push('');
  }

  for (const stream of ['stdout.raw.txt', 'stderr.raw.txt'] as const) {
    const text = await readGuardEvidenceAt(repoRoot, evidenceDir, stream);
    if (text && text.trim().length > 0) {
      lines.push(`### focus step ${stream} (head)`);
      lines.push(clip(text.trimEnd(), DIGEST_STREAM_CHARS));
      lines.push('');
    }
  }

  lines.push('### Evidence files (page with `read_evidence`)');
  lines.push(files.join(', '));

  return { digest: lines.join('\n'), files };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (truncated — read_evidence for the rest)` : text;
}
