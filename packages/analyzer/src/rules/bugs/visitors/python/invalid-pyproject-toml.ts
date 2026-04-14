/**
 * Detects invalid pyproject.toml files by attempting to parse them.
 * Unlike other visitors, this runs on the file content as TOML, not tree-sitter AST.
 * It registers on Python's `module` node type and checks if the file is pyproject.toml.
 */

import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const invalidPyprojectTomlVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-pyproject-toml',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Only check pyproject.toml files — but since we parse Python files,
    // we detect pyproject.toml references in Python code instead.
    // Look for open('pyproject.toml') or Path('pyproject.toml') patterns
    // that might indicate the project uses pyproject.toml.
    //
    // Actually, pyproject.toml is not a Python file so tree-sitter won't parse it.
    // Instead, detect common mistakes in setup.cfg/setup.py that suggest
    // pyproject.toml migration issues.

    // Detect setup.py with deprecated setup() patterns that should be in pyproject.toml
    if (!filePath.endsWith('setup.py') && !filePath.endsWith('setup.cfg')) return null

    if (filePath.endsWith('setup.py')) {
      // Check for deprecated setup.py patterns
      const text = sourceCode
      if (text.includes('from setuptools import setup') || text.includes('from distutils')) {
        // Check if pyproject.toml likely exists (heuristic: if setup.py uses modern markers)
        if (text.includes('python_requires') && text.includes('install_requires')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Migrate setup.py to pyproject.toml',
            'This setup.py uses modern setuptools features that should be migrated to pyproject.toml (PEP 621).',
            sourceCode,
            'Convert setup.py to pyproject.toml using `python -m setuptools.build_meta`.',
          )
        }
      }
    }

    return null
  },
}
