import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const implicitGlobalDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-global-declaration',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration', 'function_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag top-level declarations (parent is program/module)
    const parent = node.parent
    if (!parent) return null
    if (parent.type !== 'program') return null

    if (node.type === 'variable_declaration') {
      const kind = node.children[0]
      if (!kind || kind.text !== 'var') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Implicit global var declaration',
        '`var` declaration at global scope pollutes the global namespace.',
        sourceCode,
        'Use `let` or `const` inside a module, or wrap in an IIFE.',
      )
    }

    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Function declaration in global scope: ${name?.text ?? 'fn'}`,
        'Function declaration at global scope creates a global variable.',
        sourceCode,
        'Wrap in a module or use an ES module export.',
      )
    }

    return null
  },
}
