import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Returns true if the file is a CommonJS module: it contains a
 * `module.exports = ...` or `exports.foo = ...` assignment anywhere
 * in the file. In such files, `require()` is the correct module-
 * loading syntax and should not be flagged.
 *
 * We scan the whole tree (rather than only top-level statements)
 * because tree-sitter occasionally wraps mixed ESM/CJS files in
 * ERROR-recovery nodes, leaving the `module.exports` assignment
 * buried under a `statement_block`/`method_definition` wrapper.
 * Real-world CJS modules nearly always have this assignment at
 * (or very near) the top level, so a whole-tree scan is a safe
 * proxy for "this file is CommonJS".
 */
function isCommonJsModule(node: SyntaxNode): boolean {
  // Walk up to the program root.
  let root: SyntaxNode = node
  while (root.parent) root = root.parent

  function check(n: SyntaxNode): boolean {
    if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left')
      if (left) {
        if (left.type === 'member_expression') {
          const obj = left.childForFieldName('object')
          const prop = left.childForFieldName('property')
          if (obj && obj.type === 'identifier') {
            if (obj.text === 'exports') return true
            if (obj.text === 'module' && prop && prop.text === 'exports') return true
          }
        } else if (left.type === 'identifier' && left.text === 'exports') {
          return true
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c && check(c)) return true
    }
    return false
  }

  return check(root)
}

export const requireImportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-import',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'require') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argList = args.namedChildren
    if (argList.length === 0) return null

    // Skip if the file itself is CommonJS (uses `module.exports`/`exports.foo`
    // at the top level). In CJS modules, `require()` is the correct syntax.
    if (isCommonJsModule(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'require() in TypeScript',
      '`require()` is CommonJS syntax. Use ES module `import` syntax in TypeScript files.',
      sourceCode,
      'Replace `const x = require("module")` with `import x from "module"`.',
    )
  },
}
