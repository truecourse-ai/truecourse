import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const tooManyClassesPerFileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-classes-per-file',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    let classCount = 0

    function walk(n: SyntaxNode) {
      if (n.type === 'class_declaration') {
        classCount++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    if (classCount > 3) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many classes per file',
        `File has ${classCount} class declarations (max 3). Split into separate modules for better maintainability.`,
        sourceCode,
        'Move each class to its own file.',
      )
    }
    return null
  },
}
