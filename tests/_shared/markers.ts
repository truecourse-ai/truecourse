/**
 * Marker parsers for the negative/positive fixture pair.
 *
 * The fixtures use two inline comment conventions to declare expectations:
 *
 *   // VIOLATION: <ruleKey>
 *   <code that should trigger the rule>
 *
 *   // INVARIANT-DRIFT: rest-contract — <obligationKey>
 *   <code site that drifts from SPEC.md>
 *
 * Both are 1:1 with the line of code immediately after them. The text after
 * the em-dash on an INVARIANT-DRIFT line is the plugin's stable
 * `obligationKey` — same role as `ruleKey` for static rules — so the test
 * can match a violation back to a marker by exact-string comparison.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface ExpectedRuleViolation {
  /** e.g. `code-quality/deterministic/missing-return-type`. */
  ruleKey: string;
  filePath: string;
  /** 1-indexed line of the violating code (line AFTER the comment). */
  line: number;
}

export interface ExpectedInvariantDrift {
  /** Plugin type after the keyword, e.g. `rest-contract`. */
  pluginType: string;
  /**
   * Plugin's stable obligation identifier (e.g. `POST /users status-409`).
   * Same role as `ruleKey` for static rules — exact-match against the
   * persisted invariant's `obligationKey`.
   */
  obligationKey: string;
  filePath: string;
  /** 1-indexed line of the drifting code. */
  line: number;
}

function walkSourceFiles(rootPath: string, onFile: (fullPath: string, content: string) => void): void {
  for (const entry of readdirSync(rootPath).sort()) {
    const full = join(rootPath, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.truecourse') continue;
      walkSourceFiles(full, onFile);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      onFile(full, readFileSync(full, 'utf-8'));
    }
  }
}

/**
 * Parse all `// VIOLATION: rule-key` markers in the fixture. The expected
 * violation is on the line immediately after the comment.
 */
export function parseExpectedViolations(rootPath: string): ExpectedRuleViolation[] {
  const out: ExpectedRuleViolation[] = [];
  walkSourceFiles(rootPath, (filePath, content) => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\/\/\s*VIOLATION:\s*(.+)/);
      if (m) {
        out.push({
          ruleKey: m[1].trim(),
          filePath,
          line: i + 2,
        });
      }
    }
  });
  return out;
}

/**
 * Parse all `// INVARIANT-DRIFT: <plugin-type> — <claim>` markers. Distinct
 * keyword from VIOLATION so the existing rule parser ignores them.
 */
export function parseInvariantDriftMarkers(rootPath: string): ExpectedInvariantDrift[] {
  const out: ExpectedInvariantDrift[] = [];
  walkSourceFiles(rootPath, (filePath, content) => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/\/\/\s*INVARIANT-DRIFT:\s*(\S+)\s*[—-]\s*(.+)/);
      if (m) {
        out.push({
          pluginType: m[1].trim(),
          obligationKey: m[2].trim(),
          filePath,
          line: i + 2,
        });
      }
    }
  });
  return out;
}
