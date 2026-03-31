import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readTelemetryConfig,
  writeTelemetryConfig,
  bucketFileCount,
  bucketDuration,
  detectLanguages,
  getSystemInfo,
} from '../../apps/server/src/services/telemetry.service';
import type { AnalysisResult } from '../../apps/server/src/services/analyzer.service';

let tmpDir: string;
const originalHome = process.env.HOME;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-telemetry-test-'));
  process.env.HOME = tmpDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Config read/write
// ---------------------------------------------------------------------------

describe('readTelemetryConfig', () => {
  it('creates config with defaults when no file exists', () => {
    const config = readTelemetryConfig();
    expect(config.enabled).toBe(true);
    expect(config.anonymousId).toBeTruthy();
    expect(config.anonymousId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('persists config to disk on first read', () => {
    readTelemetryConfig();
    const configPath = path.join(tmpDir, '.truecourse', 'telemetry.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.enabled).toBe(true);
    expect(raw.anonymousId).toBeTruthy();
  });

  it('returns same anonymousId on subsequent reads', () => {
    const first = readTelemetryConfig();
    const second = readTelemetryConfig();
    expect(first.anonymousId).toBe(second.anonymousId);
  });

  it('reads back written config', () => {
    writeTelemetryConfig({ enabled: false });
    const config = readTelemetryConfig();
    expect(config.enabled).toBe(false);
  });
});

describe('writeTelemetryConfig', () => {
  it('creates intermediate directories', () => {
    const dir = path.join(tmpDir, '.truecourse');
    expect(fs.existsSync(dir)).toBe(false);
    writeTelemetryConfig({ enabled: true });
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('merges with existing config', () => {
    // First write creates config with anonymousId
    const config = readTelemetryConfig();
    const originalId = config.anonymousId;

    // Second write only changes enabled, preserves anonymousId
    writeTelemetryConfig({ enabled: false });
    const updated = readTelemetryConfig();
    expect(updated.enabled).toBe(false);
    expect(updated.anonymousId).toBe(originalId);
  });
});

// ---------------------------------------------------------------------------
// Bucketing helpers
// ---------------------------------------------------------------------------

describe('bucketFileCount', () => {
  it('buckets small counts as 1-50', () => {
    expect(bucketFileCount(1)).toBe('1-50');
    expect(bucketFileCount(50)).toBe('1-50');
  });

  it('buckets medium counts as 50-200', () => {
    expect(bucketFileCount(51)).toBe('50-200');
    expect(bucketFileCount(200)).toBe('50-200');
  });

  it('buckets large counts as 200-500', () => {
    expect(bucketFileCount(201)).toBe('200-500');
    expect(bucketFileCount(500)).toBe('200-500');
  });

  it('buckets very large counts as 500+', () => {
    expect(bucketFileCount(501)).toBe('500+');
    expect(bucketFileCount(10000)).toBe('500+');
  });
});

describe('bucketDuration', () => {
  it('buckets fast analyses as <5s', () => {
    expect(bucketDuration(0)).toBe('<5s');
    expect(bucketDuration(4999)).toBe('<5s');
  });

  it('buckets 5-15s range', () => {
    expect(bucketDuration(5000)).toBe('5-15s');
    expect(bucketDuration(14999)).toBe('5-15s');
  });

  it('buckets 15-60s range', () => {
    expect(bucketDuration(15000)).toBe('15-60s');
    expect(bucketDuration(59999)).toBe('15-60s');
  });

  it('buckets 1-5m range', () => {
    expect(bucketDuration(60000)).toBe('1-5m');
    expect(bucketDuration(299999)).toBe('1-5m');
  });

  it('buckets long analyses as 5m+', () => {
    expect(bucketDuration(300000)).toBe('5m+');
    expect(bucketDuration(600000)).toBe('5m+');
  });
});

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

describe('detectLanguages', () => {
  function makeResult(files: string[][]): AnalysisResult {
    return {
      services: files.map((f, i) => ({
        name: `service-${i}`,
        rootPath: `/tmp/service-${i}`,
        type: 'api-server' as const,
        fileCount: f.length,
        layers: [],
        files: f,
      })),
      architecture: 'monolith',
      dependencies: [],
      layerDetails: [],
      databaseResult: { connections: [], schemas: [] },
      modules: [],
      methods: [],
      moduleLevelDependencies: [],
      methodLevelDependencies: [],
      fileAnalyses: [],
      moduleDependencies: [],
      entryPointFiles: new Set<string>(),
      metadata: {},
    } as AnalysisResult;
  }

  it('detects TypeScript from .ts and .tsx files', () => {
    const result = makeResult([['src/index.ts', 'src/App.tsx']]);
    expect(detectLanguages(result)).toEqual(['typescript']);
  });

  it('detects JavaScript from .js and .jsx files', () => {
    const result = makeResult([['src/index.js', 'src/App.jsx']]);
    expect(detectLanguages(result)).toEqual(['javascript']);
  });

  it('detects multiple languages across services', () => {
    const result = makeResult([
      ['src/index.ts'],
      ['app/main.py'],
    ]);
    const langs = detectLanguages(result);
    expect(langs).toContain('typescript');
    expect(langs).toContain('python');
  });

  it('deduplicates languages', () => {
    const result = makeResult([
      ['src/a.ts', 'src/b.ts', 'src/c.tsx'],
    ]);
    expect(detectLanguages(result)).toEqual(['typescript']);
  });

  it('returns sorted array', () => {
    const result = makeResult([
      ['main.py', 'index.ts', 'app.go'],
    ]);
    expect(detectLanguages(result)).toEqual(['go', 'python', 'typescript']);
  });

  it('ignores unknown extensions', () => {
    const result = makeResult([['README.md', 'data.csv', 'Makefile']]);
    expect(detectLanguages(result)).toEqual([]);
  });

  it('returns empty array for no services', () => {
    const result = makeResult([]);
    expect(detectLanguages(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

describe('getSystemInfo', () => {
  it('returns os as platform-arch', () => {
    const info = getSystemInfo();
    expect(info.os).toBe(`${process.platform}-${process.arch}`);
  });

  it('returns a version string', () => {
    const info = getSystemInfo();
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
