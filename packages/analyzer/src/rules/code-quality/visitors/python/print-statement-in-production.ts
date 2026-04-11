import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonModuleNode } from '../../../_shared/python-helpers.js'

/** Per-module cache: does this file have a top-level `if __name__ == "__main__":` guard? */
const scriptLikeCache = new WeakMap<SyntaxNode, boolean>()

/**
 * True if the file contains a top-level `if __name__ == "__main__":` block
 * (i.e., it's a script / CLI tool / entry point). Print calls anywhere in
 * a script-like file are considered legitimate — scripts exist to print
 * to stdout as their primary output channel.
 *
 * The check is cached per-module via WeakMap so the scan happens once per file.
 */
function isScriptLikeFile(node: SyntaxNode): boolean {
  const module = getPythonModuleNode(node)
  const cached = scriptLikeCache.get(module)
  if (cached !== undefined) return cached

  let found = false
  for (const child of module.namedChildren) {
    if (child.type === 'if_statement') {
      const condition = child.childForFieldName('condition')
      if (condition && isDunderMainComparison(condition)) {
        found = true
        break
      }
    }
  }
  scriptLikeCache.set(module, found)
  return found
}

/** Matches `__name__ == "__main__"` or `"__main__" == __name__`. */
function isDunderMainComparison(n: SyntaxNode): boolean {
  if (n.type !== 'comparison_operator') return false
  const first = n.namedChildren[0]
  const second = n.namedChildren[1]
  if (!first || !second) return false

  const isNameIdent = (node: SyntaxNode) =>
    node.type === 'identifier' && node.text === '__name__'
  const isMainString = (node: SyntaxNode) => {
    if (node.type !== 'string') return false
    const stripped = node.text.replace(/^['"]|['"]$/g, '')
    return stripped === '__main__'
  }

  return (isNameIdent(first) && isMainString(second)) || (isMainString(first) && isNameIdent(second))
}

export const pythonPrintStatementInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/print-statement-in-production',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Skip test files — check the filename. Require `test_` or `_test.` to
    // actually appear in the BASENAME. Matching just the dir name (e.g.
    // `test/file.py`) would be too broad and hit unit-test harnesses that
    // use synthetic paths.
    const segments = filePath.split('/')
    const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
    const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''
    if (
      fileName.startsWith('test_') || fileName.endsWith('_test.py') || fileName === 'conftest.py'
    ) return null

    // Skip common CLI / script / tooling directories outright — print() is the
    // primary output channel for scripts and shouldn't be flagged.
    if (
      dirName === 'scripts' || dirName === 'bin' || dirName === 'tools' ||
      dirName === 'cli' || dirName === 'cmd'
    ) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'print') return null

    // Skip ALL print() calls in files that have a top-level
    // `if __name__ == "__main__":` guard — these files are scripts / CLI
    // tools / entry points where print is legitimate. Pre-fix this rule
    // fired on every print call in every Python script.
    if (isScriptLikeFile(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'print() in production code',
      '`print()` should not be used in production code — use the `logging` module for structured output with log levels.',
      sourceCode,
      'Replace `print()` with `logging.debug()`, `logging.info()`, etc.',
    )
  },
}
