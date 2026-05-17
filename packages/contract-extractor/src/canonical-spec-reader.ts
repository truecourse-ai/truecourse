/**
 * Canonical-spec reader. Module 2's input is now `.truecourse/spec/`,
 * the consolidator's output. Replaces the old `specs.yaml` + raw-doc
 * walk.
 *
 * Layout (from Module 1's materializer):
 *
 *   .truecourse/spec/
 *   ├── modules/<name>/module.yaml          (manifest — status, scope, outOfScope)
 *   ├── modules/<name>/<topic>.md           (LLM-rendered prose, free-form)
 *   ├── shared/<topic>.md                   (cross-cutting prose)
 *   └── decisions.json                      (echoed for reference; not read)
 *
 * Each section file becomes one or more spec slices via the existing
 * markdown slicer — Module 2's downstream pipeline (cache → runner →
 * merger → validator → writer) is unchanged.
 *
 * `module.yaml` metadata flows through alongside the slices so the
 * contract extractor can:
 *   - skip slices for modules with status `out-of-scope`
 *   - tag IL artifacts with `planned` / `deferred` status (later;
 *     C.8 in PLAN.md)
 *   - emit `outOfScope` markers as anti-spec (later; C.9)
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { sliceMarkdown } from './slicer.js';
import type { SpecSlice } from './types.js';

export interface CanonicalModuleInfo {
  /** Module slug — directory name under modules/. `_shared` for cross-cutting. */
  name: string;
  /** Parsed module.yaml — present for modules/<name>/, absent for shared/. */
  manifest?: ManifestData;
  /** Section files belonging to this module. */
  sectionFiles: string[];
}

export interface ManifestData {
  name: string;
  status: 'shipped' | 'planned' | 'deferred' | 'deprecated' | 'out-of-scope';
  description?: string;
  sourceDocs: string[];
  scope: { paths?: string[]; tags?: string[] };
  outOfScope?: Array<{ id: string; reason?: string; source: string }>;
  lastReviewed?: string;
}

export interface CanonicalReadResult {
  /** Slices to feed the extraction pipeline. */
  slices: SpecSlice[];
  /** Per-module info for downstream stages that care about manifests. */
  modules: CanonicalModuleInfo[];
}

const SHARED_DIR = 'shared';
const MODULES_DIR = 'modules';

export function canonicalSpecPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'spec');
}

export function hasCanonicalSpec(repoRoot: string): boolean {
  const root = canonicalSpecPath(repoRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return false;
  // Either modules/ or shared/ has to be present for there to be any
  // content worth extracting.
  return (
    fs.existsSync(path.join(root, MODULES_DIR)) ||
    fs.existsSync(path.join(root, SHARED_DIR))
  );
}

/**
 * Walk `.truecourse/spec/` and return the slices the LLM extractor
 * should be called on. Modules with status `out-of-scope` at the
 * manifest level contribute zero slices — their content is negative
 * spec, not positive contract.
 */
export function readCanonicalSpec(repoRoot: string): CanonicalReadResult {
  const specRoot = canonicalSpecPath(repoRoot);
  if (!hasCanonicalSpec(repoRoot)) {
    return { slices: [], modules: [] };
  }
  const slices: SpecSlice[] = [];
  const modules: CanonicalModuleInfo[] = [];

  // Per-module dirs.
  const modulesDir = path.join(specRoot, MODULES_DIR);
  if (fs.existsSync(modulesDir)) {
    const moduleNames = fs
      .readdirSync(modulesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of moduleNames) {
      const dir = path.join(modulesDir, name);
      const manifest = readManifestIfPresent(dir);
      const info: CanonicalModuleInfo = {
        name,
        manifest,
        sectionFiles: [],
      };
      if (manifest?.status === 'out-of-scope') {
        // Module wholly excluded — no slices. Manifest still surfaced
        // so callers can see it.
        modules.push(info);
        continue;
      }
      for (const file of listMarkdown(dir)) {
        info.sectionFiles.push(file);
        const rel = path.relative(repoRoot, file).split(path.sep).join('/');
        const source = fs.readFileSync(file, 'utf-8');
        for (const slice of sliceMarkdown(rel, source)) slices.push(slice);
      }
      modules.push(info);
    }
  }

  // shared/ — cross-cutting; treated as a synthetic _shared module.
  const sharedDir = path.join(specRoot, SHARED_DIR);
  if (fs.existsSync(sharedDir)) {
    const sharedFiles = listMarkdown(sharedDir);
    if (sharedFiles.length > 0) {
      const sharedInfo: CanonicalModuleInfo = {
        name: '_shared',
        sectionFiles: sharedFiles,
      };
      for (const file of sharedFiles) {
        const rel = path.relative(repoRoot, file).split(path.sep).join('/');
        const source = fs.readFileSync(file, 'utf-8');
        for (const slice of sliceMarkdown(rel, source)) slices.push(slice);
      }
      modules.push(sharedInfo);
    }
  }

  return { slices, modules };
}

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function readManifestIfPresent(moduleDir: string): ManifestData | undefined {
  const file = path.join(moduleDir, 'module.yaml');
  if (!fs.existsSync(file)) return undefined;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = yaml.load(raw) as ManifestData | undefined;
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}
