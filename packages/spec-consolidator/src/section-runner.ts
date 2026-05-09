/**
 * Per-section materialization runner. Given a (module, topic, claims)
 * triple, calls Claude once and returns canonical markdown for that
 * section file (e.g. `modules/auth/endpoints.md`).
 *
 * Same shape as the per-block extraction runner — injectable so tests
 * can pass a stub. The stub is the default in test code; production
 * uses `spawnSectionRunner()` which shells out to the `claude` CLI.
 */

import { spawn } from 'node:child_process';
import os from 'node:os';
import pLimit from 'p-limit';
import type { Claim, Topic } from './types.js';

export interface PendingSection {
  /** Module slug — '_shared' for cross-cutting. */
  module: string;
  topic: Topic;
  /** Section file name to write (`endpoints.md`, `auth.md`, ...). */
  fileName: string;
  /** Resolved claims that contribute to this section. */
  claims: Claim[];
}

export interface RenderedSection {
  module: string;
  topic: Topic;
  fileName: string;
  markdown?: string;
  error?: string;
  durationMs: number;
}

export type SectionRunner = (sections: PendingSection[]) => Promise<RenderedSection[]>;

export interface SpawnSectionRunnerOptions {
  bin?: string;
  concurrency?: number;
  timeoutMs?: number;
  onSectionStart?: (section: PendingSection) => void;
  onSectionDone?: (section: PendingSection, ok: boolean) => void;
}

function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return Math.min(os.cpus().length, 4);
}

export function spawnSectionRunner(
  opts: SpawnSectionRunnerOptions = {},
): SectionRunner {
  const bin = opts.bin ?? process.env.CLAUDE_CODE_BIN ?? 'claude';
  const concurrency = opts.concurrency ?? defaultConcurrency();
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const limit = pLimit(concurrency);

  return async (sections) =>
    Promise.all(
      sections.map((section) =>
        limit(async () => {
          opts.onSectionStart?.(section);
          const t0 = Date.now();
          try {
            const markdown = await renderOne(bin, section, timeoutMs);
            opts.onSectionDone?.(section, true);
            return {
              module: section.module,
              topic: section.topic,
              fileName: section.fileName,
              markdown,
              durationMs: Date.now() - t0,
            };
          } catch (e) {
            opts.onSectionDone?.(section, false);
            return {
              module: section.module,
              topic: section.topic,
              fileName: section.fileName,
              error: e instanceof Error ? e.message : String(e),
              durationMs: Date.now() - t0,
            };
          }
        }),
      ),
    );
}

async function renderOne(
  bin: string,
  section: PendingSection,
  timeoutMs: number,
): Promise<string> {
  const userPrompt = buildUserPrompt(section);
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

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`claude timed out after ${timeoutMs}ms for ${section.module}/${section.fileName}`));
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
      try {
        const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
        const text = typeof envelope === 'string' ? envelope : envelope.result;
        if (typeof text !== 'string') {
          reject(new Error(`claude returned no text for ${section.module}/${section.fileName}`));
          return;
        }
        resolve(stripCodeFences(text).trim() + '\n');
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are the canonical-spec writer for the TrueCourse Spec Consolidator.

You receive a module slug, a topic, and a list of resolved CLAIMS extracted from the project's docs. Each claim has a subject (e.g. "POST /orders") and content (a structured shape — a route's responses, an entity's fields, an error envelope shape).

Your job is to write a clean, free-form markdown section that describes everything the claims state. The reader is a developer or product owner.

Rules:

  1. Faithfulness. Encode ONLY what the claims state. Do not add details from your own knowledge of similar systems. Do not guess defaults.
  2. Free-form prose. Use natural language with markdown structure (H2/H3 headings, lists, fenced code blocks for examples). Do not output YAML front-matter or structured key-value blocks.
  3. Group naturally. Endpoints can have a heading per route ("### POST /orders"); data shapes can have a heading per entity. Use whatever structure fits the content.
  4. Status. When a claim has status: "planned" | "deferred" | "out-of-scope" | "deprecated", note that next to the claim's heading (e.g. "### POST /orders/refund — *planned*"). Don't note "shipped" — it's the default.
  5. Provenance. Don't include file paths, line numbers, or "(from docs/PRDs/v2.md)" — the canonical spec stands on its own.
  6. Output. Return ONLY the markdown body. No preamble, no fences around the whole thing, no commentary.`;

function buildUserPrompt(section: PendingSection): string {
  const heading = topicHeading(section.topic);
  const claimsBlock = section.claims
    .map((c, i) => {
      const status = c.metadata.status ? ` [status: ${c.metadata.status}]` : '';
      return [
        `Claim ${i + 1}: ${c.subject}${status}`,
        `Content: ${JSON.stringify(c.content, null, 2)}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return [
    `Module: ${section.module}`,
    `Topic: ${section.topic}`,
    `Suggested top-level heading: # ${heading}`,
    '',
    'Claims to encode:',
    '',
    claimsBlock,
  ].join('\n');
}

function topicHeading(topic: Topic): string {
  switch (topic) {
    case 'auth': return 'Authentication';
    case 'endpoints': return 'Endpoints';
    case 'data': return 'Data shapes';
    case 'errors': return 'Errors';
    case 'effects': return 'Effects';
    case 'overview': return 'Overview';
    default: return topic;
  }
}
