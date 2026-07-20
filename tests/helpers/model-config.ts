import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Scaffolding shared by the per-stage model-selection tests: env vars that must
 * be saved/cleared/restored around each case, and throwaway repos carrying a
 * `.truecourse/config.json`.
 *
 * Every model resolution in those suites passes `repoDir` explicitly — the repo
 * the suite runs in is itself a `.truecourse` project, so a defaulted call would
 * read the repo's own config and pass/fail by machine state.
 */

/** Env vars that steer model resolution. Cleared before each case. */
export const MODEL_ENV_KEYS = [
  'TRUECOURSE_MODEL',
  'CLAUDE_CODE_MODEL',
  'TRUECOURSE_FALLBACK_MODEL',
  'TRUECOURSE_MODEL_RULES_VIOLATION_GEN',
  'TRUECOURSE_MODEL_RULES_FLOW_ENRICH',
  'TRUECOURSE_MODEL_SPEC_AREA_TAG',
] as const;

export interface ModelConfigSandbox {
  /** Clear the tracked env vars — call from `beforeEach`. */
  reset(): void;
  /** Restore the originals and delete every temp dir — call from `afterEach`. */
  cleanup(): void;
  /** A repo root with a `.truecourse/` marker and optional config.json body. */
  makeRepo(config?: unknown): string;
  /** (Over)write `<repo>/.truecourse/config.json`. */
  writeConfig(repoDir: string, config: unknown): void;
  /** A tracked temp dir with no `.truecourse/` marker. */
  makeTmpDir(prefix: string): string;
}

/**
 * @param extraEnvKeys env vars beyond MODEL_ENV_KEYS this suite also mutates
 *   (e.g. `CLAUDE_CODE_BINARY` for the spawn-path suite).
 */
export function modelConfigSandbox(extraEnvKeys: readonly string[] = []): ModelConfigSandbox {
  const keys = [...MODEL_ENV_KEYS, ...extraEnvKeys];
  // Captured once at construction, i.e. before any case has mutated them.
  const originals = new Map<string, string | undefined>(keys.map((k) => [k, process.env[k]]));
  const tmpDirs: string[] = [];

  const makeTmpDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
  };

  const writeConfig = (repoDir: string, config: unknown): void => {
    fs.writeFileSync(
      path.join(repoDir, '.truecourse', 'config.json'),
      // A string body is written verbatim so tests can plant malformed JSON.
      typeof config === 'string' ? config : JSON.stringify(config),
      'utf-8',
    );
  };

  return {
    reset() {
      for (const k of keys) delete process.env[k];
    },
    cleanup() {
      for (const k of keys) {
        const v = originals.get(k);
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    },
    makeTmpDir,
    writeConfig,
    makeRepo(config?: unknown) {
      const dir = makeTmpDir('tc-model-repo-');
      fs.mkdirSync(path.join(dir, '.truecourse'), { recursive: true });
      if (config !== undefined) writeConfig(dir, config);
      return dir;
    },
  };
}
