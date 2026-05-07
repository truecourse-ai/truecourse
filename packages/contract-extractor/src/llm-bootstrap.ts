/**
 * LLM-driven bootstrap for `.truecourse/specs.yaml`.
 *
 * Walks the repo, collects markdown candidates with previews, and sends
 * them to Claude Code in one shot. The LLM proposes which files are
 * specs, what rank each gets, and a brief reason for the proposal. The
 * CLI surfaces the reasoning so the user can review before approval.
 *
 * Mirrors the per-slice runner's subprocess shape (`claude -p
 * --output-format json --append-system-prompt …`) so a single mental
 * model covers all the LLM calls in this package. The schema is
 * Zod-validated; on parse failure or subprocess error the caller falls
 * back to the deterministic heuristic in `bootstrap.ts`.
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { BootstrapCandidate, BootstrapProposal } from './bootstrap.js';
import type { SpecsConfig } from './types.js';

// ---------------------------------------------------------------------------
// LLM I/O schema
// ---------------------------------------------------------------------------

const LlmEntrySchema = z.object({
  file: z.string(),
  rank: z.number().int().nonnegative(),
  reason: z.string(),
});
const LlmExclusionSchema = z.object({
  file: z.string(),
  reason: z.string(),
});
const LlmProposalSchema = z.object({
  specs: z.array(LlmEntrySchema),
  excluded: z.array(LlmExclusionSchema).default([]),
  /** One-paragraph summary of the proposal — shown above the list. */
  summary: z.string().optional(),
});
export type LlmBootstrapProposal = z.infer<typeof LlmProposalSchema> & {
  /** Per-entry reasons surfaced separately so the CLI can render them
   *  alongside the proposed specs.yaml without re-deriving. */
  reasons: Map<string, string>;
};

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `\
You bootstrap a TrueCourse spec configuration (.truecourse/specs.yaml) for a repository.

You are given a list of markdown file candidates with previews. Decide which
ones are PROSE SPECIFICATIONS that describe API contracts, domain rules,
state machines, or system invariants — i.e. the kind of document a contract
verifier should derive obligations from.

# What counts as a spec

- A "base spec" — top-level service description (often SPEC.md, API.md, etc.)
- ADRs / RFCs that introduce or amend contractual obligations
- Standalone design docs that describe end-user-visible API behavior

# What does NOT count

- README / overview / marketing copy
- CHANGELOG / release notes
- Internal style guides, contribution docs, runbooks
- Architecture overviews that describe \`how\` the system is built but
  don't establish externally-visible obligations

# Layering rank

Higher rank wins on conflict. Convention:
  rank 0 — base spec (foundational, oldest)
  rank 1 — ADRs (refine the base, ordered by recency)
  rank 2 — RFCs / latest amendments (override both)

If you see a series (multiple ADRs in the same directory), pick a glob
("docs/adr/*.md") rather than enumerating individual files. Globs
support \`*\` (one path segment) and \`**\` (any number).

# Output

Return EXACTLY this JSON shape — no prose, no markdown fences:

{
  "summary": "<one paragraph: what kind of repo this is, what was found>",
  "specs": [
    { "file": "<path or glob>", "rank": <int>, "reason": "<why this is a spec at this rank>" }
  ],
  "excluded": [
    { "file": "<path>", "reason": "<why excluded>" }
  ]
}

# Hard rules

1. Output ONLY the JSON. No prose, no markdown fences, no preamble.
2. \`file\` must be relative to the repo root, never absolute.
3. Be conservative — if a file might just be an overview, exclude it.
4. Always provide a \`reason\` per entry; one short sentence is enough.
5. If NO candidates qualify as specs, return \`{"summary": "...", "specs": [], "excluded": [...]}\` and the caller will tell the user to write a SPEC.md.
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LlmBootstrapOptions {
  /** Override the binary; defaults to `CLAUDE_CODE_BIN` env or `claude`. */
  bin?: string;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Run one Claude Code call against the candidate list. Resolves to a
 * BootstrapProposal in the same shape the heuristic produces, plus a
 * Map of per-entry reasons (so the CLI can render them inline).
 *
 * Throws on subprocess failure, malformed JSON, or schema mismatch — the
 * caller catches these and falls back to the deterministic heuristic.
 */
export async function proposeWithLlm(
  candidates: BootstrapCandidate[],
  opts: LlmBootstrapOptions = {},
): Promise<{ proposal: BootstrapProposal; reasons: Map<string, string>; summary?: string }> {
  const bin = opts.bin ?? process.env.CLAUDE_CODE_BIN ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const userPrompt = buildUserPrompt(candidates);
  const args = [
    '-p',
    userPrompt,
    '--output-format',
    'json',
    '--append-system-prompt',
    SYSTEM_PROMPT,
    '--setting-sources',
    'project',
  ];

  const text = await spawnAndCollect(bin, args, timeoutMs);
  const inner = JSON.parse(stripCodeFences(text));
  const parsed = LlmProposalSchema.parse(inner);

  const config: SpecsConfig = {
    specs: parsed.specs.map(({ file, rank }) => ({ file, rank })),
  };
  const reasons = new Map<string, string>();
  for (const entry of parsed.specs) reasons.set(entry.file, entry.reason);

  return {
    proposal: { config, excluded: parsed.excluded ?? [] },
    reasons,
    summary: parsed.summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserPrompt(candidates: BootstrapCandidate[]): string {
  const lines: string[] = [
    `Repo has ${candidates.length} markdown file${candidates.length === 1 ? '' : 's'} to consider.`,
    '',
    'Each candidate is below with its first ~200 lines as context. Classify them and produce the JSON proposal.',
    '',
  ];
  for (const c of candidates) {
    lines.push(`--- ${c.file}  (heuristic kind: ${c.kind}) ---`);
    lines.push(c.preview);
    lines.push('--- end ---');
    lines.push('');
  }
  lines.push('Now produce the JSON proposal as specified.');
  return lines.join('\n');
}

function spawnAndCollect(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`claude bootstrap timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (b: Buffer) => stdout.push(b));
    proc.stderr.on('data', (b: Buffer) => stderr.push(b));
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${Buffer.concat(stderr).toString('utf-8')}`));
        return;
      }
      // Claude Code's --output-format json wraps the model's text response
      // in a {result: "..."} envelope. Pull the inner text out before
      // re-parsing as the proposal JSON.
      const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
      const text = typeof envelope === 'string' ? envelope : envelope.result;
      if (typeof text !== 'string') {
        reject(new Error(`claude returned no text for bootstrap`));
        return;
      }
      resolve(text);
    });
  });
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : trimmed;
}
