/**
 * Materializer. Takes the merge result + detected modules and writes
 * the canonical `.truecourse/spec/` tree:
 *
 *   .truecourse/spec/
 *   ├── modules/
 *   │   └── <name>/
 *   │       ├── module.yaml          ← deterministic
 *   │       ├── overview.md          ← LLM-written (when overview claims exist)
 *   │       ├── endpoints.md         ← LLM-written (when endpoints claims exist)
 *   │       ├── auth.md              ← LLM-written
 *   │       ├── data.md              ← LLM-written
 *   │       ├── errors.md            ← LLM-written
 *   │       └── effects.md           ← LLM-written
 *   ├── shared/<topic>.md            ← _shared module rendered without
 *   │                                  modules/ prefix per the agreed layout
 *   └── decisions.json               ← deterministic
 *
 * The runner is injected. Tests pass a stub that returns canned
 * markdown so the materializer's wiring is verifiable without LLM
 * calls. Production uses `spawnSectionRunner()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { DetectedModule } from './module-detector.js';
import { SHARED_MODULE } from './module-detector.js';
import type { MergeResult } from './merger.js';
import type {
  Claim,
  DecisionsFile,
  ModuleManifest,
  Topic,
} from './types.js';
import {
  spawnSectionRunner,
  type PendingSection,
  type RenderedSection,
  type SectionRunner,
} from './section-runner.js';

export interface MaterializeOptions {
  /** Override the per-section LLM runner. Tests pass a stub. */
  runner?: SectionRunner;
  /** Hooks for progress UIs. */
  onSectionDone?: (section: RenderedSection) => void;
  /**
   * Skip writing `decisions.json` even when present. Useful when the
   * caller wants to manage that file separately (CLI may already
   * have written it from a previous step).
   */
  skipDecisions?: boolean;
}

export interface MaterializeResult {
  /** Files written, repo-relative. */
  written: string[];
  /** Per-section runs that errored. */
  failures: Array<{ section: PendingSection; error: string }>;
}

/**
 * Run the materializer.
 *
 * @param specRoot   Absolute path to `.truecourse/spec/`. Created if missing.
 * @param merge      Output of `mergeClaims()` — resolvedClaims + decided.
 * @param modules    Output of `detectModules()` — module groupings.
 * @param decisions  The decisions file to write into the spec tree (Q12).
 */
export async function materializeSpec(
  specRoot: string,
  merge: MergeResult,
  modules: DetectedModule[],
  decisions: DecisionsFile,
  opts: MaterializeOptions = {},
): Promise<MaterializeResult> {
  fs.mkdirSync(specRoot, { recursive: true });

  // Build the section work list: one PendingSection per (module, topic).
  // Decided conflicts whose resolution is `pick` contribute their picked
  // claim to the section; `custom` decisions contribute a synthesized
  // claim with the user's free-text content.
  const renderableClaims = collectRenderableClaims(merge);
  const claimsByModuleTopic = new Map<string, Claim[]>();
  const claimToModule = attributeClaimsToModules(renderableClaims, modules);

  for (const claim of renderableClaims) {
    const moduleName = claimToModule.get(claim.id);
    if (!moduleName) continue;
    const key = `${moduleName}::${claim.topic}`;
    const list = claimsByModuleTopic.get(key) ?? [];
    list.push(claim);
    claimsByModuleTopic.set(key, list);
  }

  const sections: PendingSection[] = [];
  for (const [key, claims] of claimsByModuleTopic) {
    const [moduleName, topic] = key.split('::') as [string, Topic];
    sections.push({
      module: moduleName,
      topic,
      fileName: `${topic}.md`,
      claims,
    });
  }

  // Sort for stable concurrency ordering and progress display.
  sections.sort((a, b) =>
    a.module === b.module
      ? a.topic.localeCompare(b.topic)
      : a.module.localeCompare(b.module),
  );

  const runner = opts.runner ?? spawnSectionRunner();
  const rendered = await runner(sections);
  for (const r of rendered) opts.onSectionDone?.(r);

  const written: string[] = [];
  const failures: MaterializeResult['failures'] = [];

  // Write each section's markdown.
  for (const r of rendered) {
    if (!r.markdown) {
      const original = sections.find(
        (s) => s.module === r.module && s.fileName === r.fileName,
      );
      if (original) failures.push({ section: original, error: r.error ?? '(no markdown)' });
      continue;
    }
    const targetPath = sectionFilePath(specRoot, r.module, r.fileName);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, r.markdown);
    written.push(path.relative(specRoot, targetPath));
  }

  // Write each module's manifest. Skipped for _shared — it has no
  // module.yaml; its scope is global by convention.
  for (const m of modules) {
    if (m.name === SHARED_MODULE) continue;
    const manifestPath = path.join(specRoot, 'modules', m.name, 'module.yaml');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, renderManifest(m.manifest));
    written.push(path.relative(specRoot, manifestPath));
  }

  // Write decisions.json (Q12: batch apply — caller decided to apply now).
  if (!opts.skipDecisions) {
    const decisionsPath = path.join(specRoot, 'decisions.json');
    fs.writeFileSync(decisionsPath, JSON.stringify(decisions, null, 2) + '\n');
    written.push(path.relative(specRoot, decisionsPath));
  }

  return { written, failures };
}

// ---------------------------------------------------------------------------
// Internal: assemble renderable claims (resolved + decided)
// ---------------------------------------------------------------------------

function collectRenderableClaims(merge: MergeResult): Claim[] {
  const out: Claim[] = [...merge.resolvedClaims];
  for (const decided of merge.decidedConflicts) {
    if (decided.resolvedClaim) {
      out.push(decided.resolvedClaim);
      continue;
    }
    // Custom resolution — synthesize a claim from the user's content.
    if (decided.decision.resolution.kind === 'custom') {
      out.push(synthesizeCustomClaim(decided.conflict, decided.decision.resolution.content, decided.decision.resolvedAt));
    }
  }
  return out;
}

function synthesizeCustomClaim(
  conflict: { topic: Topic; subject: string; module?: string },
  content: string,
  resolvedAt: string,
): Claim {
  return {
    id: `custom-${conflict.topic}-${conflict.subject}`,
    topic: conflict.topic,
    subject: conflict.subject,
    content: { _custom: content },
    provenance: {
      file: '.truecourse/spec/decisions.json',
      line: 0,
      quote: content,
    },
    metadata: {
      docKind: 'unknown',
      lastTouched: resolvedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal: map each renderable claim to a module
// ---------------------------------------------------------------------------

function attributeClaimsToModules(
  claims: Claim[],
  modules: DetectedModule[],
): Map<string, string> {
  const out = new Map<string, string>();
  // Use the existing module attribution: for each module's claims,
  // pin them. Custom claims (not in any module's claims) fall to
  // _shared — a safe default for user-supplied content.
  const moduleByClaimId = new Map<string, string>();
  for (const m of modules) {
    for (const c of m.claims) moduleByClaimId.set(c.id, m.name);
  }
  for (const c of claims) {
    out.set(c.id, moduleByClaimId.get(c.id) ?? SHARED_MODULE);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal: file-path layout
// ---------------------------------------------------------------------------

function sectionFilePath(specRoot: string, moduleName: string, fileName: string): string {
  if (moduleName === SHARED_MODULE) {
    return path.join(specRoot, 'shared', fileName);
  }
  return path.join(specRoot, 'modules', moduleName, fileName);
}

// ---------------------------------------------------------------------------
// Manifest serialization
// ---------------------------------------------------------------------------

function renderManifest(manifest: ModuleManifest): string {
  // Light wrapper around js-yaml; we strip undefined fields so the
  // file stays clean rather than carrying `null`s for every absent
  // optional.
  const clean: Record<string, unknown> = {
    name: manifest.name,
    status: manifest.status,
  };
  if (manifest.description) clean.description = manifest.description;
  clean.sourceDocs = manifest.sourceDocs;
  clean.scope = manifest.scope;
  if (manifest.outOfScope && manifest.outOfScope.length > 0) {
    clean.outOfScope = manifest.outOfScope;
  }
  if (manifest.lastReviewed) clean.lastReviewed = manifest.lastReviewed;
  return yaml.dump(clean, { lineWidth: 100, sortKeys: false });
}
