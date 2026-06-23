/**
 * Project-mode mirror of csharp-negative.test.ts for the Roslyn-WORKSPACE rules.
 *
 * These rules (engine `roslyn-workspace`) need the real .csproj loaded via
 * MSBuildWorkspace — they cannot fire on loose file texts, so the loose-text
 * harness excludes their markers and defers them here. This test loads the fixture
 * projects (which requires `dotnet restore`, hence a network/SDK gate) and enforces
 * the same Level-2 discipline: every workspace rule fires (coverage), every marker
 * fires (recall), and every fire is marked (no false positives).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { runRoslynWorkspace, resolveRoslynHostBinary } from '../../packages/analyzer/src/roslyn-host-client';
import { DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/index';
import type { RoslynHostViolation } from '../../packages/analyzer/src/roslyn-host-client';

const FIXTURE = new URL('../fixtures/sample-csharp-project-negative', import.meta.url).pathname;
const PROJECTS = [
  'services/UserService/UserService.csproj',
  'services/ApiGateway/ApiGateway.csproj',
  'shared/Utils/Utils.csproj',
].map((p) => join(FIXTURE, p));

const hostBuilt = resolveRoslynHostBinary() !== null;
function dotnetAvailable(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const canRun = hostBuilt && dotnetAvailable();

function workspaceRuleKeys(): string[] {
  return DETERMINISTIC_RULES.filter((r) => r.enabled && r.engine === 'roslyn-workspace').map((r) => r.key);
}

interface Marker {
  ruleKey: string;
  rel: string; // path relative to FIXTURE
  line: number; // 1-indexed line of the violating code (first non-comment line below)
}

function collectCsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'bin' || entry === 'obj' || entry === '.git') continue;
      collectCsFiles(full, out);
    } else if (entry.endsWith('.cs')) {
      out.push(full);
    }
  }
  return out;
}

function parseMarkers(keys: string[]): Marker[] {
  const wanted = new Set(keys);
  const markers: Marker[] = [];
  for (const file of collectCsFiles(FIXTURE)) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/VIOLATION:\s*(\S+)/);
      if (!m || !wanted.has(m[1])) continue;
      let j = i + 1;
      while (j < lines.length && /^\s*\/\//.test(lines[j])) j++;
      markers.push({ ruleKey: m[1], rel: relative(FIXTURE, file), line: j + 1 });
    }
  }
  return markers;
}

const fireKey = (ruleKey: string, rel: string, line: number) => `${ruleKey}::${rel}::${line}`;

describe.skipIf(!canRun)('C# project fixture — workspace rules (analyze-project)', () => {
  const keys = workspaceRuleKeys();
  let fires: Array<{ ruleKey: string; rel: string; line: number }>;
  let markers: Marker[];

  beforeAll(async () => {
    for (const proj of PROJECTS) execFileSync('dotnet', ['restore', proj], { stdio: 'ignore' });
    const raw: RoslynHostViolation[] = [];
    for (const proj of PROJECTS) raw.push(...(await runRoslynWorkspace(proj, keys)));
    fires = raw.map((v) => ({ ruleKey: v.ruleKey, rel: relative(FIXTURE, v.path), line: v.line }));
    markers = parseMarkers(keys);
  }, 300_000);

  it('every workspace rule fires at least once (coverage)', () => {
    const fired = new Set(fires.map((v) => v.ruleKey));
    const uncovered = keys.filter((k) => !fired.has(k));
    if (uncovered.length > 0) console.log('\nUNCOVERED WORKSPACE RULES:', uncovered.join(', '));
    expect(uncovered).toEqual([]);
  });

  it('finds a violation for each workspace marker', () => {
    const fireSet = new Set(fires.map((v) => fireKey(v.ruleKey, v.rel, v.line)));
    const missing = markers.filter((m) => !fireSet.has(fireKey(m.ruleKey, m.rel, m.line)));
    if (missing.length > 0) {
      console.log('\nMISSING WORKSPACE VIOLATIONS:');
      for (const m of missing) console.log(`  ${m.ruleKey} at ${m.rel}:${m.line}`);
    }
    expect(missing).toEqual([]);
  });

  it('does not produce unexpected workspace violations', () => {
    const markerSet = new Set(markers.map((m) => fireKey(m.ruleKey, m.rel, m.line)));
    const unexpected = fires.filter((v) => v.rel.includes('/Violations/') && !markerSet.has(fireKey(v.ruleKey, v.rel, v.line)));
    if (unexpected.length > 0) {
      console.log('\nUNEXPECTED WORKSPACE VIOLATIONS:');
      for (const v of unexpected) console.log(`  ${v.ruleKey} at ${v.rel}:${v.line}`);
    }
    expect(unexpected).toEqual([]);
  });
});
