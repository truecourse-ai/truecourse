#!/usr/bin/env npx tsx
/**
 * Rule Coverage Verification Tool
 *
 * Cross-references source rule files (RUFF, SONAR-PYTHON, ESLINT, SONARJS, GITLEAKS)
 * against ALL-RULES.md to find rules that aren't covered.
 *
 * Pass 1: Exact Source ID matching (fast, no LLM)
 * Pass 2: Write unmatched rules to JSON for semantic review via Claude agents
 *
 * Usage:
 *   npx tsx docs/research/verify-rules.ts docs/research/RUFF-RULES.md
 *   npx tsx docs/research/verify-rules.ts --all
 */

import { readFileSync, writeFileSync } from "fs";
import { basename, join, dirname } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SourceRule {
  id: string;
  secondaryId?: string; // e.g., SonarJS S-number
  name: string;
  description: string;
  deprecated: boolean;
  section?: string; // which markdown section it was under
}

interface MatchResult {
  matched: SourceRule[];
  skipped: SourceRule[];
  unmatched: SourceRule[];
}

type SourceFormat =
  | "ruff"
  | "sonar-python"
  | "eslint"
  | "sonarjs"
  | "gitleaks"
  | "engineering";

// ─── Exclusion rules ────────────────────────────────────────────────────────

function isRuffExcluded(id: string): boolean {
  // Pycodestyle formatting: E1xx, E2xx, E3xx, E5xx, E7xx (keep E4xx errors, E9xx syntax errors)
  if (/^E[12357]\d{2}$/.test(id)) return true;
  // Pycodestyle warnings: W (all formatting)
  if (/^W\d/.test(id)) return true;
  // Pydocstyle docstrings: D
  if (/^D\d/.test(id)) return true;
  // Naming conventions: N
  if (/^N\d/.test(id)) return true;
  // Import sorting: I
  if (/^I\d/.test(id)) return true;
  // Trailing commas: COM
  if (/^COM/.test(id)) return true;
  // Quotes: Q
  if (/^Q\d/.test(id)) return true;
  // Annotations: ANN (type annotation style)
  if (/^ANN/.test(id)) return true;
  // Era: ERA (commented-out code is stylistic)
  if (/^ERA/.test(id)) return true;
  return false;
}

const SONAR_PYTHON_SKIP_IDS = new Set([
  "BackticksUsage", // Python 2
  "ExecStatementUsage", // Python 2
  "PrintStatementUsage", // Python 2
  "CommentRegularExpression", // meta/tracking
  "LineLength", // formatting
  "LongIntegerWithLowercaseSuffixUsage", // formatting
  "InequalityUsage", // Python 2 (<> operator)
]);

const SONAR_PYTHON_SKIP_PATTERNS: RegExp[] = [
  /python2/i, // Python 2 compat tags
];

function isSonarPythonExcluded(rule: SourceRule): boolean {
  if (SONAR_PYTHON_SKIP_IDS.has(rule.id)) return true;
  // Check tags in description/section for python2
  if (rule.description && SONAR_PYTHON_SKIP_PATTERNS.some((p) => p.test(rule.description))) return true;
  return false;
}

const ESLINT_SKIP_SECTIONS = new Set([
  "Layout & Formatting",
  "Deprecated Rules",
]);

const SONARJS_SKIP_RULES = new Set([
  "comment-regex", // meta/tracking (S124)
  "class-name", // naming convention (S101)
]);

// ─── Parse ALL-RULES.md ─────────────────────────────────────────────────────

/**
 * Expand range notations like "C400-C420" into individual IDs:
 * C400, C401, ..., C420
 */
function expandRange(range: string): string[] {
  const match = range.match(/^([A-Z]+)(\d+)-([A-Z]*)(\d+)$/);
  if (!match) return [range];
  const prefix = match[1];
  const start = parseInt(match[2], 10);
  const end = parseInt(match[4], 10);
  const padLen = match[2].length;
  const ids: string[] = [];
  for (let i = start; i <= end; i++) {
    ids.push(`${prefix}${String(i).padStart(padLen, "0")}`);
  }
  return ids;
}

/**
 * Expand slash-separated notations like "ASYNC210/220/230/240/250/251"
 * into ASYNC210, ASYNC220, ASYNC230, ASYNC240, ASYNC250, ASYNC251
 */
function expandSlashNotation(value: string): string[] {
  // Match: PREFIX123/456/789
  const match = value.match(/^([A-Z]+)(\d+)((?:\/\d+)+)$/);
  if (!match) return [value];
  const prefix = match[1];
  const first = match[2];
  const rest = match[3].split("/").filter(Boolean);
  return [first, ...rest].map((n) => `${prefix}${n}`);
}

/**
 * Extract wildcard name patterns like "UnnecessaryGenerator*" from parentheticals
 * and return them as regex patterns
 */
function extractNamePatterns(sourceIdCell: string): RegExp[] {
  const patterns: RegExp[] = [];
  // Find all parenthetical contents
  const parenMatches = sourceIdCell.match(/\(([^)]+)\)/g);
  if (!parenMatches) return patterns;

  for (const paren of parenMatches) {
    const inner = paren.slice(1, -1); // strip parens
    // Split on / or , for multiple names
    const names = inner.split(/[/,]/).map((s) => s.trim());
    for (const name of names) {
      if (name.endsWith("*")) {
        // Wildcard: "UnnecessaryGenerator*" matches UnnecessaryGeneratorList, etc.
        const prefix = name.slice(0, -1);
        patterns.push(new RegExp(`^${escapeRegex(prefix)}`, "i"));
      } else if (name.length > 3 && /^[A-Z]/.test(name)) {
        // Exact name match (PascalCase names like "UnusedImport")
        patterns.push(new RegExp(`^${escapeRegex(name)}$`, "i"));
      }
    }
  }
  return patterns;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAllRulesSourceIds(filePath: string): { ids: Set<string>; namePatterns: RegExp[] } {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const ids = new Set<string>();
  const namePatterns: RegExp[] = [];

  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // Skip header/separator rows
    if (cells.length < 8) continue;
    if (cells[1] === "Our Key" || cells[1].startsWith("---")) continue;

    // Source ID is column 6 (index 6 in split array since first element is empty from leading |)
    const sourceIdCell = cells[6];
    if (!sourceIdCell || sourceIdCell === "-") continue;

    // Extract name patterns from parentheticals (wildcards like UnnecessaryGenerator*)
    namePatterns.push(...extractNamePatterns(sourceIdCell));

    // Strip all parentheticals for ID extraction
    const stripped = sourceIdCell.replace(/\s*\([^)]*\)\s*/g, " ");

    // Split on commas
    const rawIds = stripped.split(",").map((s) => s.trim()).filter(Boolean);

    for (const rawId of rawIds) {
      if (rawId === "-" || rawId.startsWith("all ")) continue;

      // Try expanding range notation: C400-C420
      if (/^[A-Z]+\d+-[A-Z]*\d+$/.test(rawId)) {
        for (const expanded of expandRange(rawId)) {
          ids.add(expanded);
          ids.add(expanded.toLowerCase());
        }
        continue;
      }

      // Try expanding slash notation: ASYNC210/220/230
      if (/^[A-Z]+\d+(?:\/\d+)+$/.test(rawId)) {
        for (const expanded of expandSlashNotation(rawId)) {
          ids.add(expanded);
          ids.add(expanded.toLowerCase());
        }
        continue;
      }

      // Simple ID — may contain multiple space-separated IDs from stripped parens
      const subIds = rawId.split(/\s+/).filter((s) => s && s !== "-");
      for (const subId of subIds) {
        ids.add(subId);
        ids.add(subId.toLowerCase());
      }
    }
  }

  return { ids, namePatterns };
}

// ─── Parse source files ─────────────────────────────────────────────────────

function detectFormat(filePath: string): SourceFormat {
  const name = basename(filePath).toUpperCase();
  if (name.includes("RUFF")) return "ruff";
  if (name.includes("SONAR-PYTHON") || name.includes("SONARPYTHON")) return "sonar-python";
  if (name.includes("SONARJS")) return "sonarjs";
  if (name.includes("ESLINT")) return "eslint";
  if (name.includes("GITLEAKS")) return "gitleaks";
  if (name.includes("ENGINEERING")) return "engineering";
  throw new Error(`Cannot detect format for: ${filePath}`);
}

function parseTableRows(content: string): { cells: string[]; section: string }[] {
  const lines = content.split("\n");
  const rows: { cells: string[]; section: string }[] = [];
  let currentSection = "";

  for (const line of lines) {
    // Track section headers (## or ###)
    const sectionMatch = line.match(/^#{2,3}\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // Skip header/separator rows
    if (cells.length < 3) continue;
    if (cells[1].startsWith("---") || cells[1] === "Rule ID" || cells[1] === "Rule Name" ||
        cells[1] === "Our Key" || cells[1] === "#" ||
        cells[1].startsWith("**") || cells[1] === "Rule Name ") continue;

    rows.push({ cells, section: currentSection });
  }

  return rows;
}

/** Check if a string looks like a valid Ruff rule ID (e.g., E101, PLR0913, ASYNC210) */
function isRuffId(s: string): boolean {
  return /^[A-Z]{1,5}\d{3,4}$/.test(s);
}

/** Check if a string looks like a valid ESLint rule ID (kebab-case) */
function isEslintId(s: string): boolean {
  return /^[a-z][\w-]+$/.test(s) && !s.includes(" ");
}

/** Check if a string looks like a valid SonarPython rule ID (PascalCase name or S-number) */
function isSonarPythonId(s: string): boolean {
  // Must be PascalCase (uppercase start, has lowercase) or S-number
  // Excludes all-caps like "BUG", "VULNERABILITY", "CODE_SMELL"
  if (/^S\d{3,5}$/.test(s)) return true;
  if (/^[A-Z][a-zA-Z]+$/.test(s) && /[a-z]/.test(s)) return true;
  return false;
}

/** Check if a string looks like a valid SonarJS rule name (kebab-case) */
function isSonarJsId(s: string): boolean {
  return /^[a-z][\w-]+$/.test(s) && !s.includes(" ");
}

function parseRuff(filePath: string): SourceRule[] {
  const content = readFileSync(filePath, "utf-8");
  const rows = parseTableRows(content);
  const rules: SourceRule[] = [];

  for (const { cells, section } of rows) {
    // | Rule ID | Name | Category | Deprecated |
    // cells[0] is empty (leading |), so: id=1, name=2, category=3, deprecated=4
    const id = cells[1];
    const name = cells[2];
    const deprecated = (cells[4] || "").toLowerCase().includes("yes");
    if (!id || !name) continue;
    // Skip summary/count rows that aren't real rule IDs
    if (!isRuffId(id)) continue;

    rules.push({
      id,
      name,
      description: `${name} (${cells[3] || ""})`,
      deprecated,
      section,
    });
  }

  return rules;
}

function parseSonarPython(filePath: string): SourceRule[] {
  const content = readFileSync(filePath, "utf-8");
  const rows = parseTableRows(content);
  const rules: SourceRule[] = [];

  for (const { cells, section } of rows) {
    // | Rule ID | Title | Type | Severity | Status | Tags |
    // cells: [empty, id, title, type, severity, status, tags]
    const id = cells[1];
    const title = cells[2];
    const status = cells[5] || "";
    const tags = cells[6] || "";
    const deprecated = status.toLowerCase().includes("deprecated");
    if (!id || !title) continue;
    // Skip summary rows (e.g., "BUG | 104", "Type | Count")
    if (!isSonarPythonId(id)) continue;

    rules.push({
      id,
      name: title,
      description: `${title} [${cells[3] || ""}] tags: ${tags}`,
      deprecated,
      section,
    });
  }

  // Deduplicate — SonarPython lists some rules in multiple sections
  const seen = new Set<string>();
  return rules.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function parseEslint(filePath: string): SourceRule[] {
  const content = readFileSync(filePath, "utf-8");
  const rows = parseTableRows(content);
  const rules: SourceRule[] = [];

  for (const { cells, section } of rows) {
    // ESLint core: | Rule Name | Description | Recommended | Fixable | Deprecated |
    // @typescript-eslint: | Rule Name | Description | Recommended | Fixable | Needs Type Info | Deprecated |
    const id = cells[1];
    const description = cells[2];
    if (!id || !description) continue;
    // Skip summary rows (e.g., "ESLint Core - Possible Problems | 59")
    if (!isEslintId(id)) continue;

    // Check if it's in the deprecated column
    const deprecated =
      section.includes("Deprecated") ||
      (cells.length >= 6 && cells[5]?.toLowerCase() === "yes") ||
      (cells.length >= 7 && cells[6]?.toLowerCase() === "yes");

    rules.push({
      id,
      name: id,
      description,
      deprecated,
      section,
    });
  }

  // Deduplicate — some ESLint rules appear in both core and @typescript-eslint
  const seen = new Set<string>();
  return rules.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function parseSonarjs(filePath: string): SourceRule[] {
  const content = readFileSync(filePath, "utf-8");
  const rows = parseTableRows(content);
  const rules: SourceRule[] = [];

  for (const { cells, section } of rows) {
    // | Rule Name | S-Number | Description | Deprecated | Needs Type Info |
    const name = cells[1];
    const sNumber = cells[2];
    const description = cells[3];
    const deprecated = (cells[4] || "").toLowerCase().includes("yes") ||
                       (cells[4] || "").trim() === "Yes";
    if (!name || !sNumber) continue;
    // Skip summary rows — SonarJS rule names are kebab-case, S-numbers are S+digits
    if (!isSonarJsId(name) || !/^S\d+$/.test(sNumber)) continue;

    rules.push({
      id: name,
      secondaryId: sNumber,
      name,
      description: description || name,
      deprecated,
      section,
    });
  }

  return rules;
}

function parseGitleaks(filePath: string): SourceRule[] {
  const content = readFileSync(filePath, "utf-8");
  const rows = parseTableRows(content);
  const rules: SourceRule[] = [];

  for (const { cells, section } of rows) {
    // | # | Rule ID | Description | Entropy | Keywords |
    const id = (cells[2] || "").replace(/`/g, ""); // strip backticks
    const description = cells[3];
    if (!id) continue;

    rules.push({
      id,
      name: id,
      description: description || id,
      deprecated: false,
      section,
    });
  }

  return rules;
}

function parseSourceFile(filePath: string): { format: SourceFormat; rules: SourceRule[] } {
  const format = detectFormat(filePath);
  let rules: SourceRule[];

  switch (format) {
    case "ruff":
      rules = parseRuff(filePath);
      break;
    case "sonar-python":
      rules = parseSonarPython(filePath);
      break;
    case "eslint":
      rules = parseEslint(filePath);
      break;
    case "sonarjs":
      rules = parseSonarjs(filePath);
      break;
    case "gitleaks":
      rules = parseGitleaks(filePath);
      break;
    default:
      throw new Error(`Unsupported format: ${format}`);
  }

  return { format, rules };
}

// ─── Matching ───────────────────────────────────────────────────────────────

function applyExclusions(rules: SourceRule[], format: SourceFormat): { active: SourceRule[]; skipped: SourceRule[] } {
  const active: SourceRule[] = [];
  const skipped: SourceRule[] = [];

  for (const rule of rules) {
    // Universal: skip deprecated
    if (rule.deprecated) {
      skipped.push(rule);
      continue;
    }

    let excluded = false;

    switch (format) {
      case "ruff":
        excluded = isRuffExcluded(rule.id);
        break;
      case "sonar-python":
        excluded = isSonarPythonExcluded(rule);
        break;
      case "eslint":
        excluded = ESLINT_SKIP_SECTIONS.has(rule.section || "");
        break;
      case "sonarjs":
        excluded = SONARJS_SKIP_RULES.has(rule.id);
        break;
      case "gitleaks":
        // Gitleaks rules are all consolidated under one entry in ALL-RULES.md
        // They're matched differently — we just note they're all covered
        excluded = false;
        break;
    }

    if (excluded) {
      skipped.push(rule);
    } else {
      active.push(rule);
    }
  }

  return { active, skipped };
}

function matchRules(activeRules: SourceRule[], knownIds: Set<string>, namePatterns: RegExp[], format: SourceFormat): MatchResult {
  const matched: SourceRule[] = [];
  const unmatched: SourceRule[] = [];

  for (const rule of activeRules) {
    let found = false;

    // Check primary ID
    if (knownIds.has(rule.id) || knownIds.has(rule.id.toLowerCase())) {
      found = true;
    }

    // Check secondary ID (e.g., SonarJS S-number)
    if (!found && rule.secondaryId) {
      if (knownIds.has(rule.secondaryId) || knownIds.has(rule.secondaryId.toLowerCase())) {
        found = true;
      }
    }

    // Check Ruff name against wildcard/exact name patterns from ALL-RULES.md
    if (!found && rule.name) {
      found = namePatterns.some((p) => p.test(rule.name));
    }

    // For gitleaks: all rules are consolidated under one entry
    if (!found && format === "gitleaks") {
      found = true;
    }

    if (found) {
      matched.push(rule);
    } else {
      unmatched.push(rule);
    }
  }

  return { matched, skipped: [], unmatched };
}

// ─── Output ─────────────────────────────────────────────────────────────────

function printReport(fileName: string, format: SourceFormat, totalRules: number, skipped: SourceRule[], result: MatchResult) {
  const divider = "═".repeat(60);
  console.log(`\n${divider}`);
  console.log(`  ${fileName} (${format})`);
  console.log(divider);
  console.log(`  Total rules in source:  ${totalRules}`);
  console.log(`  Skipped (excluded):     ${skipped.length} (deprecated/formatting/naming/docstrings)`);
  console.log(`  Active rules checked:   ${totalRules - skipped.length}`);
  console.log(`  ✓ Matched (exact ID):   ${result.matched.length}`);
  console.log(`  ✗ Unmatched:            ${result.unmatched.length}`);
  console.log(divider);

  if (result.unmatched.length > 0) {
    console.log(`\n  Unmatched rules:\n`);
    for (const rule of result.unmatched) {
      const secondary = rule.secondaryId ? ` (${rule.secondaryId})` : "";
      console.log(`    ${rule.id}${secondary} — ${rule.name}`);
    }
  }
}

function writeUnmatchedJson(dir: string, fileName: string, unmatched: SourceRule[]) {
  const outPath = join(dir, `.unmatched-${fileName.replace(".md", "")}.json`);
  const data = unmatched.map((r) => ({
    id: r.id,
    secondaryId: r.secondaryId,
    name: r.name,
    description: r.description,
    section: r.section,
  }));
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n  → Unmatched rules written to: ${outPath}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

function processFile(sourceFilePath: string, knownIds: Set<string>, namePatterns: RegExp[]) {
  const fileName = basename(sourceFilePath);
  const { format, rules } = parseSourceFile(sourceFilePath);
  const { active, skipped } = applyExclusions(rules, format);
  const result = matchRules(active, knownIds, namePatterns, format);

  printReport(fileName, format, rules.length, skipped, result);

  if (result.unmatched.length > 0) {
    writeUnmatchedJson(dirname(sourceFilePath), fileName, result.unmatched);
  }

  return result;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage:");
    console.log("  npx tsx docs/research/verify-rules.ts <source-file.md>");
    console.log("  npx tsx docs/research/verify-rules.ts --all");
    process.exit(1);
  }

  const researchDir = join(process.cwd(), "docs", "research");
  const allRulesPath = join(researchDir, "ALL-RULES.md");

  console.log("Parsing ALL-RULES.md...");
  const { ids: knownIds, namePatterns } = parseAllRulesSourceIds(allRulesPath);
  console.log(`Found ${knownIds.size} known source IDs (including lowercase variants)`);
  console.log(`Found ${namePatterns.length} name patterns (wildcards/exact from parentheticals)\n`);

  const sourceFiles =
    args[0] === "--all"
      ? [
          join(researchDir, "RUFF-RULES.md"),
          join(researchDir, "SONAR-PYTHON-RULES.md"),
          join(researchDir, "ESLINT-RULES.md"),
          join(researchDir, "SONARJS-RULES.md"),
          join(researchDir, "GITLEAKS-RULES.md"),
        ]
      : args.map((a) => (a.startsWith("/") ? a : join(process.cwd(), a)));

  let totalUnmatched = 0;

  for (const file of sourceFiles) {
    const result = processFile(file, knownIds, namePatterns);
    totalUnmatched += result.unmatched.length;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TOTAL UNMATCHED ACROSS ALL SOURCES: ${totalUnmatched}`);
  console.log(`${"═".repeat(60)}`);

  if (totalUnmatched > 0) {
    console.log(`\nNext step: Run semantic matching via Claude agents on the .unmatched-*.json files.`);
  } else {
    console.log(`\nAll rules are covered!`);
  }
}

main();
