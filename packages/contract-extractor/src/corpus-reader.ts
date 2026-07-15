/**
 * Corpus-driven generation input for the contract extractor. Reads the curated
 * corpus (`.truecourse/specs/corpus.json`), applies the effective doc→doc
 * decisions, and builds one `AreaGenInput` per area — the area's relevant docs
 * (full markdown), `replace`-d docs dropped, ordered by precedence.
 *
 * Generate then reads MULTIPLE docs per area and consolidates across them (the
 * model does the merge + ignores non-spec prose). The corpus stores only DocRefs;
 * this module resolves each to content (a repo file in OSS, a blob in EE via an
 * injected resolver).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  readCorpus,
  isProcessArea,
  splitArea,
  type CuratedCorpus,
  type Status,
  type DocKind,
} from '@truecourse/spec-consolidator';

/** One source doc fed to generate for an area — the full markdown plus metadata. */
export interface AreaDoc {
  /** DocRef (repo-relative path in OSS). */
  ref: string;
  /** Full markdown content. */
  content: string;
  /** ISO timestamp — drives default precedence ordering (newest first). */
  lastTouched: string;
  /** Lifecycle status from the corpus, when known. */
  status?: Status;
  kind: DocKind;
}

/** Per-area generation input: the area + its docs in precedence order. */
export interface AreaGenInput {
  areaId: string;
  product: string;
  concern: string;
  /** Relevant docs, `replace`-d ones dropped, highest precedence first. */
  docs: AreaDoc[];
}

export interface CorpusReadOptions {
  /** Inject the corpus instead of reading `corpus.json` (EE / tests). */
  corpus?: CuratedCorpus;
  /** Resolve a DocRef to its markdown. Default reads `<repoRoot>/<ref>`; null = missing. */
  resolveContent?: (ref: string) => string | null;
  /** Include process-bucket areas (default false — they spec no behavior). */
  includeProcess?: boolean;
}

/** True when a usable `corpus.json` exists. */
export function hasCorpusSpec(repoRoot: string): boolean {
  return readCorpus(repoRoot) !== null;
}

/**
 * Read the corpus and build the per-area generation inputs: docs ordered
 * newest-first, process areas and empty areas excluded, DocRefs resolved to
 * content.
 */
export function readCorpusForGenerate(repoRoot: string, opts: CorpusReadOptions = {}): AreaGenInput[] {
  const corpus = opts.corpus ?? readCorpus(repoRoot);
  if (!corpus) return [];
  const resolve = opts.resolveContent ?? ((ref: string) => defaultResolveContent(repoRoot, ref));

  const docByRef = new Map(corpus.docs.map((d) => [d.ref, d]));

  const out: AreaGenInput[] = [];
  for (const area of corpus.areas) {
    if (!opts.includeProcess && isProcessArea(area.id)) continue;

    const docs: AreaDoc[] = [];
    for (const ref of area.docRefs) {
      const content = resolve(ref);
      if (content == null) continue; // unresolvable ref — skip rather than fail the run
      const cd = docByRef.get(ref);
      docs.push({
        ref,
        content,
        lastTouched: cd?.lastTouched ?? '',
        status: cd?.status,
        kind: cd?.kind ?? 'unknown',
      });
    }
    if (docs.length === 0) continue;

    // Newest-first so generation reads the most recent statement of an area first.
    docs.sort((a, b) => (a.lastTouched !== b.lastTouched ? (a.lastTouched < b.lastTouched ? 1 : -1) : a.ref < b.ref ? -1 : 1));
    const { product, concern } = splitArea(area.id);
    out.push({ areaId: area.id, product, concern, docs });
  }
  return out;
}


function defaultResolveContent(repoRoot: string, ref: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, ref), 'utf-8');
  } catch {
    return null;
  }
}
