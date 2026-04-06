/**
 * Validates pyproject.toml files using a TOML parser.
 * This runs outside the tree-sitter visitor pipeline since TOML is not a parsed language.
 */

import { parse as parseToml } from 'smol-toml'
import type { CodeViolation } from '@truecourse/shared'

const RULE_KEY = 'bugs/deterministic/invalid-pyproject-toml'

export function checkPyprojectToml(filePath: string, content: string): CodeViolation[] {
  const violations: CodeViolation[] = []

  // 1. Parse TOML — catch syntax errors
  let parsed: Record<string, unknown>
  try {
    parsed = parseToml(content) as Record<string, unknown>
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    // Extract line number from error if available
    const lineMatch = msg.match(/line (\d+)/i)
    const line = lineMatch ? parseInt(lineMatch[1], 10) : 1

    violations.push({
      ruleKey: RULE_KEY,
      filePath,
      lineStart: line,
      lineEnd: line,
      columnStart: 0,
      columnEnd: 0,
      severity: 'high',
      title: 'Invalid TOML syntax',
      content: `pyproject.toml has a syntax error: ${msg}`,
      snippet: content.split('\n')[line - 1] || '',
    })
    return violations
  }

  // 2. Validate required PEP 621 fields
  const project = parsed.project as Record<string, unknown> | undefined

  if (!project) {
    // Check if it's a flit/poetry/setuptools project without [project] section
    const hasBuildSystem = !!parsed['build-system']
    if (hasBuildSystem) {
      violations.push({
        ruleKey: RULE_KEY,
        filePath,
        lineStart: 1,
        lineEnd: 1,
        columnStart: 0,
        columnEnd: 0,
        severity: 'medium',
        title: 'Missing [project] section',
        content: 'pyproject.toml has [build-system] but no [project] section. PEP 621 requires [project] for package metadata.',
        snippet: '',
      })
    }
    return violations
  }

  if (!project.name) {
    violations.push({
      ruleKey: RULE_KEY,
      filePath,
      lineStart: findSectionLine(content, 'project'),
      lineEnd: findSectionLine(content, 'project'),
      columnStart: 0,
      columnEnd: 0,
      severity: 'high',
      title: 'Missing project.name',
      content: 'pyproject.toml [project] section is missing the required "name" field.',
      snippet: '',
    })
  }

  if (!project.version && !hasDynamicVersion(parsed)) {
    violations.push({
      ruleKey: RULE_KEY,
      filePath,
      lineStart: findSectionLine(content, 'project'),
      lineEnd: findSectionLine(content, 'project'),
      columnStart: 0,
      columnEnd: 0,
      severity: 'high',
      title: 'Missing project.version',
      content: 'pyproject.toml [project] section is missing the required "version" field (and version is not in dynamic).',
      snippet: '',
    })
  }

  return violations
}

function findSectionLine(content: string, section: string): number {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `[${section}]`) return i + 1
  }
  return 1
}

function hasDynamicVersion(parsed: Record<string, unknown>): boolean {
  const project = parsed.project as Record<string, unknown> | undefined
  const dynamic = project?.dynamic as string[] | undefined
  return Array.isArray(dynamic) && dynamic.includes('version')
}
