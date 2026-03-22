/**
 * Compare analysis results between two repos (e.g. API vs Claude Code CLI).
 *
 * Usage:
 *   npx tsx scripts/compare-analyses.ts <repo1-name> <repo2-name>
 *   npx tsx scripts/compare-analyses.ts sample-project sample-project2
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envFile = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* .env not found */ }

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/truecourse');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoAnalysis {
  repoName: string;
  analysisId: string;
  services: { name: string; type: string; framework: string | null; file_count: number }[];
  detViolations: { rule_key: string; severity: string; service_name: string; module_name: string | null; method_name: string | null; title: string }[];
  llmViolations: { type: string; severity: string; title: string; target_service_name: string | null; rule_key: string | null }[];
  codeViolations: { rule_key: string; severity: string; file_path: string; line_start: number; line_end: number; title: string }[];
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

async function loadRepoAnalysis(repoName: string): Promise<RepoAnalysis | null> {
  const repos = await sql`SELECT id, name FROM repos WHERE name = ${repoName}`;
  if (!repos[0]) return null;

  const analyses = await sql`SELECT id FROM analyses WHERE repo_id = ${repos[0].id} AND (metadata->>'isDiffAnalysis' IS DISTINCT FROM 'true') ORDER BY created_at DESC LIMIT 1`;
  if (!analyses[0]) return null;
  const aId = analyses[0].id as string;

  const services = await sql`SELECT name, type, framework, file_count FROM services WHERE analysis_id = ${aId} ORDER BY name`;

  const detViolations = await sql`SELECT rule_key, severity, service_name, module_name, method_name, title FROM deterministic_violations WHERE analysis_id = ${aId} ORDER BY rule_key, service_name`;

  const llmViolations = await sql`
    SELECT v.type, v.severity, v.title, s.name as target_service_name,
           dv.rule_key as det_rule_key
    FROM violations v
    LEFT JOIN services s ON v.target_service_id = s.id
    LEFT JOIN deterministic_violations dv ON v.deterministic_violation_id = dv.id
    WHERE v.analysis_id = ${aId} AND v.status = 'new' AND v.deterministic_violation_id IS NULL
    ORDER BY v.type, v.severity DESC, v.title`;

  const codeViolations = await sql`SELECT rule_key, severity, file_path, line_start, line_end, title FROM code_violations WHERE analysis_id = ${aId} AND status = 'new' ORDER BY rule_key, file_path`;

  return {
    repoName,
    analysisId: aId,
    services: services as any[],
    detViolations: detViolations as any[],
    llmViolations: llmViolations as any[],
    codeViolations: codeViolations as any[],
  };
}

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key] ?? 'null');
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function compareCountMaps(label: string, a: Record<string, number>, b: Record<string, number>, nameA: string, nameB: string) {
  const allKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  console.log(`\n  ${label}:`);
  console.log(`  ${''.padEnd(35)} ${nameA.padStart(8)} ${nameB.padStart(8)}  diff`);
  for (const key of allKeys) {
    const va = a[key] || 0;
    const vb = b[key] || 0;
    const diff = vb - va;
    const diffStr = diff === 0 ? '   =' : diff > 0 ? `  +${diff}` : `  ${diff}`;
    const marker = diff !== 0 ? ' ←' : '';
    console.log(`  ${key.padEnd(35)} ${String(va).padStart(8)} ${String(vb).padStart(8)} ${diffStr}${marker}`);
  }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(70));
}

// ---------------------------------------------------------------------------
// Main comparison
// ---------------------------------------------------------------------------

async function main() {
  const [nameA, nameB] = process.argv.slice(2);
  if (!nameA || !nameB) {
    console.error('Usage: npx tsx scripts/compare-analyses.ts <repo1-name> <repo2-name>');
    process.exit(1);
  }

  const a = await loadRepoAnalysis(nameA);
  const b = await loadRepoAnalysis(nameB);

  if (!a) { console.error(`Repo "${nameA}" not found or has no analysis`); process.exit(1); }
  if (!b) { console.error(`Repo "${nameB}" not found or has no analysis`); process.exit(1); }

  // ── Overview ──
  section(`COMPARISON: ${nameA} vs ${nameB}`);
  console.log(`  ${nameA}: analysis ${a.analysisId}`);
  console.log(`  ${nameB}: analysis ${b.analysisId}`);

  // ── Services ──
  section('SERVICES');
  const svcA = a.services.map(s => s.name).sort();
  const svcB = b.services.map(s => s.name).sort();
  const same = svcA.filter(s => svcB.includes(s));
  const onlyA = svcA.filter(s => !svcB.includes(s));
  const onlyB = svcB.filter(s => !svcA.includes(s));
  console.log(`  ${nameA}: ${svcA.length} services — ${svcA.join(', ')}`);
  console.log(`  ${nameB}: ${svcB.length} services — ${svcB.join(', ')}`);
  if (onlyA.length) console.log(`  Only in ${nameA}: ${onlyA.join(', ')}`);
  if (onlyB.length) console.log(`  Only in ${nameB}: ${onlyB.join(', ')}`);
  console.log(`  Match: ${same.length === svcA.length && same.length === svcB.length ? '✓ IDENTICAL' : '✗ DIFFERENT'}`);

  // ── Deterministic violations ──
  section('DETERMINISTIC VIOLATIONS');
  console.log(`  ${nameA}: ${a.detViolations.length} | ${nameB}: ${b.detViolations.length}`);
  compareCountMaps('By rule', countBy(a.detViolations, 'rule_key'), countBy(b.detViolations, 'rule_key'), nameA, nameB);
  compareCountMaps('By severity', countBy(a.detViolations, 'severity'), countBy(b.detViolations, 'severity'), nameA, nameB);

  // ── LLM-only violations ──
  section('LLM-ONLY VIOLATIONS (non-deterministic)');
  console.log(`  ${nameA}: ${a.llmViolations.length} | ${nameB}: ${b.llmViolations.length}`);
  compareCountMaps('By type', countBy(a.llmViolations, 'type'), countBy(b.llmViolations, 'type'), nameA, nameB);
  compareCountMaps('By severity', countBy(a.llmViolations, 'severity'), countBy(b.llmViolations, 'severity'), nameA, nameB);

  console.log(`\n  ${nameA} violations:`);
  for (const v of a.llmViolations) {
    console.log(`    [${v.type}/${v.severity}] ${v.title}`);
  }
  console.log(`\n  ${nameB} violations:`);
  for (const v of b.llmViolations) {
    console.log(`    [${v.type}/${v.severity}] ${v.title}`);
  }

  // Find similar violations by fuzzy title match
  console.log(`\n  Similarity analysis:`);
  const matched = new Set<number>();
  const unmatchedA: typeof a.llmViolations = [];
  for (const va of a.llmViolations) {
    const titleWordsA = va.title.toLowerCase().split(/\s+/);
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < b.llmViolations.length; i++) {
      if (matched.has(i)) continue;
      const titleWordsB = b.llmViolations[i].title.toLowerCase().split(/\s+/);
      const common = titleWordsA.filter(w => titleWordsB.includes(w)).length;
      const score = common / Math.max(titleWordsA.length, titleWordsB.length);
      if (score > bestScore && score >= 0.4) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      matched.add(bestIdx);
      const vb = b.llmViolations[bestIdx];
      const sevMatch = va.severity === vb.severity ? '✓' : `✗ ${va.severity}→${vb.severity}`;
      console.log(`    MATCH (${(bestScore * 100).toFixed(0)}%) sev:${sevMatch}`);
      console.log(`      A: ${va.title}`);
      console.log(`      B: ${vb.title}`);
    } else {
      unmatchedA.push(va);
    }
  }
  const unmatchedB = b.llmViolations.filter((_, i) => !matched.has(i));

  if (unmatchedA.length) {
    console.log(`\n  Only in ${nameA} (${unmatchedA.length}):`);
    for (const v of unmatchedA) console.log(`    [${v.type}/${v.severity}] ${v.title}`);
  }
  if (unmatchedB.length) {
    console.log(`\n  Only in ${nameB} (${unmatchedB.length}):`);
    for (const v of unmatchedB) console.log(`    [${v.type}/${v.severity}] ${v.title}`);
  }

  // ── Code violations ──
  section('CODE VIOLATIONS');
  console.log(`  ${nameA}: ${a.codeViolations.length} | ${nameB}: ${b.codeViolations.length}`);
  compareCountMaps('By rule', countBy(a.codeViolations, 'rule_key'), countBy(b.codeViolations, 'rule_key'), nameA, nameB);
  compareCountMaps('By severity', countBy(a.codeViolations, 'severity'), countBy(b.codeViolations, 'severity'), nameA, nameB);

  // Compare by file — normalize paths to just filename
  const codeByFileA: Record<string, number> = {};
  const codeByFileB: Record<string, number> = {};
  for (const c of a.codeViolations) {
    const f = c.file_path.split('/').pop()!;
    codeByFileA[f] = (codeByFileA[f] || 0) + 1;
  }
  for (const c of b.codeViolations) {
    const f = c.file_path.split('/').pop()!;
    codeByFileB[f] = (codeByFileB[f] || 0) + 1;
  }

  // Only show files with differences
  const allFiles = [...new Set([...Object.keys(codeByFileA), ...Object.keys(codeByFileB)])].sort();
  const diffFiles = allFiles.filter(f => (codeByFileA[f] || 0) !== (codeByFileB[f] || 0));
  if (diffFiles.length) {
    console.log(`\n  Files with different violation counts (${diffFiles.length}/${allFiles.length}):`);
    console.log(`  ${'file'.padEnd(40)} ${nameA.padStart(8)} ${nameB.padStart(8)}`);
    for (const f of diffFiles) {
      console.log(`  ${f.padEnd(40)} ${String(codeByFileA[f] || 0).padStart(8)} ${String(codeByFileB[f] || 0).padStart(8)}`);
    }
  } else {
    console.log(`\n  Files: all ${allFiles.length} files have same violation counts ✓`);
  }

  // ── Summary ──
  section('SUMMARY');
  console.log(`  ${''.padEnd(30)} ${nameA.padStart(12)} ${nameB.padStart(12)}`);
  console.log(`  ${'Services'.padEnd(30)} ${String(a.services.length).padStart(12)} ${String(b.services.length).padStart(12)}`);
  console.log(`  ${'Deterministic violations'.padEnd(30)} ${String(a.detViolations.length).padStart(12)} ${String(b.detViolations.length).padStart(12)}`);
  console.log(`  ${'LLM-only violations'.padEnd(30)} ${String(a.llmViolations.length).padStart(12)} ${String(b.llmViolations.length).padStart(12)}`);
  console.log(`  ${'Code violations'.padEnd(30)} ${String(a.codeViolations.length).padStart(12)} ${String(b.codeViolations.length).padStart(12)}`);
  const totalA = a.detViolations.length + a.llmViolations.length + a.codeViolations.length;
  const totalB = b.detViolations.length + b.llmViolations.length + b.codeViolations.length;
  console.log(`  ${'TOTAL'.padEnd(30)} ${String(totalA).padStart(12)} ${String(totalB).padStart(12)}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
