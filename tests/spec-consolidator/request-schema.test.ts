/**
 * Every spec-scan session declares its OUTCOME SCHEMA on the session def, so the
 * loop can refuse an outcome the schema rejects (and the api driver can enforce
 * the shape through structured output). This replaces the retired one-shot
 * check that each stage put a JSON schema on its `LlmRequest`.
 *
 * Each case also pins the def's `systemPrompt` to the exported constant — the
 * string the session CACHE fingerprints hash (`promptFingerprint`) — so a schema
 * addition can never move a cache key, and a prompt edit always does.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  CURATE_DOC_PROMPT_FINGERPRINT,
  CURATE_DOC_SESSION_KIND,
  CURATE_DOC_SYSTEM_PROMPT,
  DocVerdictSchema,
  curateDocSessionDef,
} from '../../packages/core/src/services/spec-scan/curate-doc';
import {
  AreaSettlementSchema,
  SETTLE_AREAS_PROMPT_FINGERPRINT,
  SETTLE_AREAS_SESSION_KIND,
  SETTLE_AREAS_SYSTEM_PROMPT,
  collectAreaVocab,
  settleAreasSessionDef,
} from '../../packages/core/src/services/spec-scan/settle-areas';
import {
  OVERLAP_SESSION_KIND,
  OVERLAP_SESSION_PROMPT_FINGERPRINT,
  OVERLAP_SESSION_SYSTEM_PROMPT,
  OverlapOutcomeSchema,
  overlapSessionDef,
} from '../../packages/core/src/services/spec-scan/overlap';
import {
  ORCHESTRATE_SYSTEM_PROMPT,
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  ScanScopeOutcomeSchema,
  buildScanScopeUniverse,
  orchestrateSessionDef,
} from '../../packages/core/src/services/spec-scan/orchestrate';
import { buildScanUniverse } from '../../packages/core/src/services/spec-scan/tools';
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content = `# ${p}\n\nThe service returns a Bearer JWT for ${p}.`): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

/** The root property names a session's outcome schema accepts. */
const props = (schema: z.ZodTypeAny): string[] =>
  Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape).sort();

const fingerprint = (prompt: string): string =>
  createHash('sha256').update(prompt, 'utf-8').digest('hex').slice(0, 16);

const DOC = doc('docs/orders-prd.md');
const UNIVERSE = buildScanUniverse([DOC]);

describe('spec-scan.curate-doc', () => {
  const def = curateDocSessionDef({
    doc: DOC,
    universe: UNIVERSE,
    liveVocab: () => ({ products: [], concerns: [] }),
  });

  it('declares the verdict schema, the prompt constant and its read tools', () => {
    expect(def.kind).toBe(CURATE_DOC_SESSION_KIND);
    expect(def.systemPrompt).toBe(CURATE_DOC_SYSTEM_PROMPT);
    expect(props(DocVerdictSchema)).toEqual(['areas', 'category', 'keep', 'reason', 'status', 'subject']);
    expect(def.outcomeSchema).toBe(DocVerdictSchema);
    expect(def.tools.map((t) => t.name).sort()).toEqual([
      'corpus_vocab',
      'list_docs',
      'read_chunk',
      'read_doc',
    ]);
    expect(def.tools.every((t) => t.readOnly && !t.destructive)).toBe(true);
  });

  it('refuses an outcome the schema rejects, and strips nothing silently', () => {
    expect(DocVerdictSchema.safeParse({ keep: true, reason: 'ok', areas: [] }).success).toBe(true);
    // A bad enum re-asks rather than degrading (no `.catch(undefined)` tolerance).
    expect(DocVerdictSchema.safeParse({ keep: true, reason: 'ok', areas: [], subject: 'nope' }).success).toBe(
      false,
    );
    // `.strict()`: an invented field is a refusal, not a silent drop.
    expect(DocVerdictSchema.safeParse({ keep: true, reason: 'ok', areas: [], extra: 1 }).success).toBe(false);
  });

  it('fingerprints the cache on the prompt constant alone', () => {
    expect(CURATE_DOC_PROMPT_FINGERPRINT).toBe(fingerprint(CURATE_DOC_SYSTEM_PROMPT));
    expect(CURATE_DOC_PROMPT_FINGERPRINT).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('spec-scan.settle-areas', () => {
  const def = settleAreasSessionDef({
    vocab: collectAreaVocab(new Map([['a.md', [{ product: 'booking', concern: 'auth' }]]])),
    universe: UNIVERSE,
  });

  it('declares the settlement schema, the prompt constant and its validator tool', () => {
    expect(def.kind).toBe(SETTLE_AREAS_SESSION_KIND);
    expect(def.systemPrompt).toBe(SETTLE_AREAS_SYSTEM_PROMPT);
    expect(props(AreaSettlementSchema)).toEqual([
      'concernMerges',
      'productMerges',
      'productVerdicts',
      'subdivisions',
    ]);
    expect(def.outcomeSchema).toBe(AreaSettlementSchema);
    expect(def.tools.map((t) => t.name).sort()).toEqual(['check_settlement', 'docs_with_label', 'read_doc']);
    // The validator's INPUT schema is the outcome schema — one definition of valid.
    expect(def.tools.find((t) => t.name === 'check_settlement')!.inputSchema).toBe(AreaSettlementSchema);
  });

  it('fingerprints the cache on the prompt constant alone', () => {
    expect(SETTLE_AREAS_PROMPT_FINGERPRINT).toBe(fingerprint(SETTLE_AREAS_SYSTEM_PROMPT));
  });
});

describe('spec-scan.overlap', () => {
  const def = overlapSessionDef({
    item: { areaId: 'core/orders', concern: 'orders', docs: [DOC], widened: [] },
    universe: UNIVERSE,
  });

  it('declares the findings schema, the prompt constant and its validator tool', () => {
    expect(def.kind).toBe(OVERLAP_SESSION_KIND);
    expect(def.systemPrompt).toBe(OVERLAP_SESSION_SYSTEM_PROMPT);
    // `sectionsOpened` is on the schema only so the RUN's transcript-derived
    // stamp can ride the cached value; it is never accepted from the session
    // (the stamp overwrites a self-report) and it is OPTIONAL, so an entry
    // cached before the field existed still parses as a hit.
    expect(props(OverlapOutcomeSchema)).toEqual(['notReached', 'overlaps', 'sectionsOpened']);
    expect(OverlapOutcomeSchema.safeParse({ overlaps: [], notReached: [] }).success).toBe(true);
    expect(def.outcomeSchema).toBe(OverlapOutcomeSchema);
    expect(def.tools.map((t) => t.name).sort()).toEqual([
      'check_findings',
      'read_doc_chunk',
      'read_section',
    ]);
  });

  it('fingerprints the cache on the prompt constant alone', () => {
    expect(OVERLAP_SESSION_PROMPT_FINGERPRINT).toBe(fingerprint(OVERLAP_SESSION_SYSTEM_PROMPT));
  });
});

describe('spec-scan.orchestrate', () => {
  const def = orchestrateSessionDef(buildScanScopeUniverse(UNIVERSE, []));

  it('declares the scope schema, the prompt constant and its read tools', () => {
    expect(def.kind).toBe(SPEC_SCAN_ORCHESTRATE_SESSION_KIND);
    expect(def.systemPrompt).toBe(ORCHESTRATE_SYSTEM_PROMPT);
    expect(props(ScanScopeOutcomeSchema)).toEqual(['findings', 'instructions', 'scopeVerdicts']);
    expect(def.outcomeSchema).toBe(ScanScopeOutcomeSchema);
    expect(def.tools.map((t) => t.name).sort()).toEqual(['doc_outline', 'list_universe']);
    // §3.7: the scope session may wait on user input; nothing ever blocks on it.
    expect(def.interactive).toBe(true);
  });

  it('never lets a session stamp its own authority or clock', () => {
    const parsed = ScanScopeOutcomeSchema.safeParse({
      scopeVerdicts: [
        { path: 'docs', verdict: 'keep', reason: 'specs', decidedAt: '2026-01-01', resolvedBy: 'user' },
      ],
      instructions: [],
    });
    expect(parsed.success).toBe(false);
  });
});
