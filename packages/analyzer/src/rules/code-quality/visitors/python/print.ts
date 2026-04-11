import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonModuleNode } from '../../../_shared/python-helpers.js'

/** Per-module cache: does this file have a top-level `if __name__ == "__main__":` guard? */
const scriptLikeCache = new WeakMap<SyntaxNode, boolean>()

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

function isDunderMainComparison(n: SyntaxNode): boolean {
  if (n.type !== 'comparison_operator') return false
  const first = n.namedChildren[0]
  const second = n.namedChildren[1]
  if (!first || !second) return false
  const isNameIdent = (nn: SyntaxNode) => nn.type === 'identifier' && nn.text === '__name__'
  const isMainString = (nn: SyntaxNode) => {
    if (nn.type !== 'string') return false
    return nn.text.replace(/^['"]|['"]$/g, '') === '__main__'
  }
  return (isNameIdent(first) && isMainString(second)) || (isMainString(first) && isNameIdent(second))
}

export const pythonPrintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Skip test files — print() in tests is fine for debug output. Require
    // `test_` or `_test.` to actually appear in the BASENAME — matching
    // `test/` as a dir name would be too broad and hit synthetic test paths.
    const segments = filePath.split('/')
    const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
    const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''
    if (
      fileName.startsWith('test_') || fileName.endsWith('_test.py') || fileName === 'conftest.py'
    ) return null

    // Skip common CLI / script / tooling directories outright.
    if (
      dirName === 'scripts' || dirName === 'bin' || dirName === 'tools' ||
      dirName === 'cli' || dirName === 'cmd'
    ) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'identifier' && fn.text === 'print') {
      // Skip ALL print() calls in files with a top-level
      // `if __name__ == "__main__":` guard — these are scripts / CLI tools
      // where print() is the legitimate user-facing output channel.
      if (isScriptLikeFile(node)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'print() call',
        'print() should be removed or replaced with a proper logger (e.g., logging module) in production code.',
        sourceCode,
        'Replace print() with logging.info() or logging.debug(), or remove it.',
      )
    }

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'logging' && attr?.text === 'debug') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'logging.debug() call',
          'logging.debug() calls may be too verbose for production. Consider removing or raising the log level.',
          sourceCode,
          'Remove logging.debug() or change to logging.info() for production.',
        )
      }
    }

    return null
  },
}
