/**
 * Persistence for the curated corpus: a single
 * `.truecourse/specs/corpus.json` snapshot of every kept doc, its area tags,
 * the area groups, and the auto-detected doc→doc relations (spec-scan redesign,
 * Phase 1). Replaces `claims-store.ts` (whole) in the corpus path.
 *
 * Committable (LATEST.json convention): expensive to regenerate (LLM tagging)
 * and not purely deterministic, so teammates inherit it from git. The per-doc
 * tag cache keeps it stable across re-scans — it changes only where docs
 * changed. In EE this overlay is Postgres rows of the same shape.
 *
 * Written deterministically by `curate()` — no LLM call at write time. On
 * corruption (Zod fails / JSON.parse throws) reads return null, matching the
 * fail-soft convention of the rest of the consolidator's stores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CuratedCorpusSchema, type Area, type CorpusDoc, type CuratedCorpus } from './corpus-types.js';
import type { Relation } from './types.js';

const CORPUS_FILE = 'corpus.json';

export function corpusFilePath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', CORPUS_FILE);
}

export function hasCorpus(repoRoot: string): boolean {
  return fs.existsSync(corpusFilePath(repoRoot));
}

export function readCorpus(repoRoot: string): CuratedCorpus | null {
  const file = corpusFilePath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return CuratedCorpusSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeCorpus(
  repoRoot: string,
  input: { docs: CorpusDoc[]; areas: Area[]; relations: Relation[]; generatedAt?: string },
): void {
  const file = corpusFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload: CuratedCorpus = {
    version: 3,
    // Caller may pass the timestamp it stamped on the in-memory corpus so the
    // returned object and the persisted file agree; else stamp now.
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    docs: input.docs,
    areas: input.areas,
    relations: input.relations,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
}
