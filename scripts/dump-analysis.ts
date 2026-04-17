/**
 * Dump all analysis data from DB for investigation.
 *
 * Usage:
 *   npx tsx scripts/dump-analysis.ts                    # dump latest normal analysis
 *   npx tsx scripts/dump-analysis.ts --diff             # dump latest diff analysis
 *   npx tsx scripts/dump-analysis.ts --id <analysisId>  # dump specific analysis
 *   npx tsx scripts/dump-analysis.ts --all              # dump all analyses for the repo
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env without requiring dotenv dependency
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
} catch { /* .env not found, use defaults */ }

import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/truecourse';
const sql = postgres(DB_URL);

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

async function getRepos() {
  return sql`SELECT id, name, path FROM repos ORDER BY created_at DESC`;
}

async function getAnalyses(repoId: string) {
  return sql`
    SELECT id, branch, architecture, metadata, created_at
    FROM analyses
    WHERE repo_id = ${repoId}
    ORDER BY created_at DESC
  `;
}

async function getAnalysis(analysisId: string) {
  const rows = await sql`SELECT id, repo_id, branch, architecture, metadata, created_at FROM analyses WHERE id = ${analysisId}`;
  return rows[0];
}

async function getServices(analysisId: string) {
  return sql`SELECT id, name, root_path, type, framework, file_count, description FROM services WHERE analysis_id = ${analysisId} ORDER BY name`;
}

async function getDeterministicViolations(analysisId: string) {
  return sql`
    SELECT id, rule_key, category, title, description, severity, service_name, module_name, method_name, file_path, is_dependency_violation
    FROM deterministic_violations
    WHERE analysis_id = ${analysisId}
    ORDER BY category, rule_key, service_name
  `;
}

async function getViolations(analysisId: string) {
  return sql`
    SELECT v.id, v.type, v.title, v.content, v.severity, v.status,
           v.target_service_id, s.name as target_service_name,
           v.target_module_id, m.name as target_module_name,
           v.target_method_id, mt.name as target_method_name,
           v.target_database_id, v.target_table,
           v.fix_prompt, v.deterministic_violation_id,
           v.first_seen_analysis_id, v.first_seen_at,
           v.previous_violation_id, v.resolved_at
    FROM violations v
    LEFT JOIN services s ON v.target_service_id = s.id
    LEFT JOIN modules m ON v.target_module_id = m.id
    LEFT JOIN methods mt ON v.target_method_id = mt.id
    WHERE v.analysis_id = ${analysisId}
    ORDER BY v.status, v.type, v.severity DESC, v.title
  `;
}

async function getCodeViolations(analysisId: string) {
  return sql`
    SELECT id, file_path, line_start, line_end, rule_key, severity, status, title, content,
           first_seen_analysis_id, first_seen_at, previous_code_violation_id, resolved_at
    FROM code_violations
    WHERE analysis_id = ${analysisId}
    ORDER BY status, rule_key, file_path
  `;
}

async function getRules() {
  return sql`SELECT key, category, name, type, severity, enabled FROM rules WHERE enabled = true ORDER BY category, type, key`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function section(title: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

function subsection(title: string) {
  console.log(`\n--- ${title} ---`);
}

function table(rows: Record<string, unknown>[], columns?: string[]) {
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  const cols = columns || Object.keys(rows[0]);
  // Truncate long values
  const formatted = rows.map((r) =>
    Object.fromEntries(cols.map((c) => {
      const val = r[c];
      const str = val === null || val === undefined ? '—' : String(val);
      return [c, str.length > 80 ? str.slice(0, 77) + '...' : str];
    }))
  );
  console.table(formatted);
}

function countBy<T>(items: T[], key: keyof T): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = String(item[key] ?? 'null');
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function dumpAnalysis(analysisId: string) {
  const analysis = await getAnalysis(analysisId);
  if (!analysis) {
    console.error(`Analysis ${analysisId} not found`);
    return;
  }

  const metadata = analysis.metadata as Record<string, unknown> | null;
  const isDiff = metadata?.isDiffAnalysis === true;

  section(`ANALYSIS: ${analysisId}`);
  console.log(`  Branch: ${analysis.branch}`);
  console.log(`  Architecture: ${analysis.architecture}`);
  console.log(`  Created: ${analysis.created_at}`);
  console.log(`  Type: ${isDiff ? 'DIFF' : 'NORMAL'}`);

  if (isDiff) {
    const changedFiles = (metadata?.changedFiles || []) as Array<{ path: string; status: string }>;
    const summary = metadata?.summary as { newCount?: number; resolvedCount?: number } | undefined;
    subsection('Changed Files');
    table(changedFiles as unknown as Record<string, unknown>[]);
    if (summary) {
      console.log(`  Summary: ${summary.newCount} new, ${summary.resolvedCount} resolved`);
    }
  }

  // Services
  const services = await getServices(analysisId);
  subsection(`Services (${services.length})`);
  table(services as unknown as Record<string, unknown>[], ['name', 'type', 'framework', 'file_count']);

  // Deterministic violations
  const detViolations = await getDeterministicViolations(analysisId);
  subsection(`Deterministic Violations (${detViolations.length})`);
  const detByRule = countBy(detViolations as unknown as Record<string, unknown>[], 'rule_key' as never);
  console.log('  By rule:', JSON.stringify(detByRule, null, 2));
  const detByCat = countBy(detViolations as unknown as Record<string, unknown>[], 'category' as never);
  console.log('  By category:', JSON.stringify(detByCat, null, 2));
  table(detViolations as unknown as Record<string, unknown>[], ['id', 'rule_key', 'category', 'severity', 'service_name', 'module_name', 'method_name', 'title']);

  // Final violations
  const violations = await getViolations(analysisId);
  subsection(`Violations (${violations.length})`);
  const vByStatus = countBy(violations as unknown as Record<string, unknown>[], 'status' as never);
  console.log('  By status:', JSON.stringify(vByStatus, null, 2));
  const vByType = countBy(violations as unknown as Record<string, unknown>[], 'type' as never);
  console.log('  By type:', JSON.stringify(vByType, null, 2));
  const vBySeverity = countBy(violations as unknown as Record<string, unknown>[], 'severity' as never);
  console.log('  By severity:', JSON.stringify(vBySeverity, null, 2));

  // Split by deterministic vs LLM-only
  const detLinked = (violations as unknown as Record<string, unknown>[]).filter((v) => v.deterministic_violation_id);
  const llmOnly = (violations as unknown as Record<string, unknown>[]).filter((v) => !v.deterministic_violation_id);
  console.log(`  Deterministic-linked: ${detLinked.length}, LLM-only: ${llmOnly.length}`);

  subsection('Violations — Deterministic-linked');
  table(detLinked, ['id', 'type', 'severity', 'status', 'title', 'target_service_name', 'target_module_name', 'target_method_name', 'deterministic_violation_id']);

  subsection('Violations — LLM-only');
  table(llmOnly, ['id', 'type', 'severity', 'status', 'title', 'target_service_name', 'target_module_name', 'target_method_name']);

  // Check for unlinked deterministic violations (det violation not referenced by any final violation)
  const linkedDetIds = new Set(detLinked.map((v) => v.deterministic_violation_id));
  const unlinkedDet = (detViolations as unknown as Record<string, unknown>[]).filter((d) => !linkedDetIds.has(d.id));
  if (unlinkedDet.length > 0) {
    subsection(`⚠ Unlinked Deterministic Violations (${unlinkedDet.length}) — no final violation references these`);
    table(unlinkedDet, ['id', 'rule_key', 'category', 'severity', 'service_name', 'module_name', 'method_name', 'title']);
  }

  // Resolved violations detail
  const resolved = (violations as unknown as Record<string, unknown>[]).filter((v) => v.status === 'resolved');
  if (resolved.length > 0) {
    subsection(`Resolved Violations (${resolved.length})`);
    table(resolved, ['id', 'type', 'severity', 'title', 'target_service_name', 'previous_violation_id', 'resolved_at']);
  }

  // New violations detail
  const newViolations = (violations as unknown as Record<string, unknown>[]).filter((v) => v.status === 'new');
  if (newViolations.length > 0) {
    subsection(`New Violations (${newViolations.length})`);
    table(newViolations, ['id', 'type', 'severity', 'title', 'target_service_name', 'target_module_name', 'deterministic_violation_id']);
  }

  // Code violations
  const codeViolations = await getCodeViolations(analysisId);
  subsection(`Code Violations (${codeViolations.length})`);
  const cvByStatus = countBy(codeViolations as unknown as Record<string, unknown>[], 'status' as never);
  console.log('  By status:', JSON.stringify(cvByStatus, null, 2));
  const cvByRule = countBy(codeViolations as unknown as Record<string, unknown>[], 'rule_key' as never);
  console.log('  By rule:', JSON.stringify(cvByRule, null, 2));
  table(codeViolations as unknown as Record<string, unknown>[], ['id', 'status', 'rule_key', 'severity', 'file_path', 'line_start', 'line_end', 'title']);
}

async function main() {
  const args = process.argv.slice(2);
  const isDiff = args.includes('--diff');
  const isAll = args.includes('--all');
  const idIndex = args.indexOf('--id');
  const specificId = idIndex >= 0 ? args[idIndex + 1] : null;

  try {
    // Get repo
    const repos = await getRepos();
    if (repos.length === 0) {
      console.error('No repos found');
      process.exit(1);
    }
    const repo = repos[0];
    section(`REPO: ${repo.name} (${repo.path})`);

    // Get enabled rules
    const rules = await getRules();
    subsection(`Enabled Rules (${rules.length})`);
    table(rules as unknown as Record<string, unknown>[], ['key', 'category', 'type', 'severity', 'name']);

    // Get analyses
    const analyses = await getAnalyses(repo.id as string);
    subsection(`Analyses (${analyses.length})`);
    for (const a of analyses) {
      const m = a.metadata as Record<string, unknown> | null;
      console.log(`  ${a.id} | ${a.branch} | ${a.created_at} | ${m?.isDiffAnalysis ? 'DIFF' : 'NORMAL'}`);
    }

    if (specificId) {
      await dumpAnalysis(specificId);
    } else if (isAll) {
      for (const a of analyses) {
        await dumpAnalysis(a.id as string);
      }
    } else {
      // Find latest normal or diff
      const target = analyses.find((a) => {
        const m = a.metadata as Record<string, unknown> | null;
        return isDiff ? m?.isDiffAnalysis === true : m?.isDiffAnalysis !== true;
      });
      if (!target) {
        console.error(`No ${isDiff ? 'diff' : 'normal'} analysis found`);
        process.exit(1);
      }
      await dumpAnalysis(target.id as string);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
