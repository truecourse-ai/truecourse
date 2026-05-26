/**
 * Composition helper shared by every category detector. A detector is a
 * list of `ChoiceSpec`s — one per value in the category's closed enum,
 * each naming the package / import / config-file signals that prove that
 * value is in use. The helper collects signals, records which choices
 * were observed, and derives a confidence.
 *
 * `absenceValue`: when set and NO choice's signals are found, the helper
 * records that value as a determinate observation (with empty signals)
 * instead of returning `inconclusive`. Used for categories where absence
 * is itself a meaningful answer — messaging `none`, runtime `node`. The
 * comparator never treats an empty-signal observation as a forbidden
 * alternative, so the absence value only ever drives `unmet-choice`.
 */

import path from 'node:path';
import { minimatch } from '../../../comparator/minimatch.js';
import type { ArchitectureCategory } from '../../../types/index.js';
import type {
  CodebaseScan,
  DetectedArchitectureChoice,
  DetectionSignal,
  ObservedChoice,
} from '../types.js';
import { packagesMatching } from './package-json.js';
import { importsMatching } from './characteristic-imports.js';
import { filesMatching, fileContentMatching } from './config-files.js';

export interface ChoiceSpec {
  value: string;
  packages?: readonly string[];
  imports?: readonly string[];
  configGlobs?: readonly string[];
  configContent?: { globs: readonly string[]; pattern: RegExp };
}

export interface DetectOptions {
  absenceValue?: string;
  scope?: { pathGlob: string };
}

export function detectByChoiceSpecs(
  category: ArchitectureCategory,
  scan: CodebaseScan,
  specs: readonly ChoiceSpec[],
  opts: DetectOptions = {},
): DetectedArchitectureChoice {
  const inScope = (s: DetectionSignal): boolean => {
    if (!opts.scope) return true;
    if (s.kind === 'package') return true; // deps aren't path-scoped
    const rel = s.source.filePath;
    return minimatch(rel, opts.scope.pathGlob) || minimatch(path.basename(rel), opts.scope.pathGlob);
  };

  const observed: ObservedChoice[] = [];
  for (const spec of specs) {
    const signals: DetectionSignal[] = [];
    if (spec.packages) signals.push(...packagesMatching(scan, spec.packages));
    if (spec.imports) signals.push(...importsMatching(scan, spec.imports));
    if (spec.configGlobs) signals.push(...filesMatching(scan, spec.configGlobs));
    if (spec.configContent) {
      signals.push(...fileContentMatching(scan, spec.configContent.globs, spec.configContent.pattern));
    }
    const scoped = signals.filter(inScope);
    if (scoped.length > 0) observed.push({ value: spec.value, signals: scoped });
  }

  if (observed.length > 0) {
    return { category, observed, confidence: 'high' };
  }
  if (opts.absenceValue) {
    return { category, observed: [{ value: opts.absenceValue, signals: [] }], confidence: 'high' };
  }
  return { category, observed: [], confidence: 'inconclusive' };
}
