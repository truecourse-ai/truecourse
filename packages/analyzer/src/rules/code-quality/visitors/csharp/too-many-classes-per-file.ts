import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpTooManyClassesPerFileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-classes-per-file',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    let classCount = 0

    // Records / structs / interfaces / enums are not counted — grouping small
    // record DTOs or an interface with its enum in one file is idiomatic C#.
    function walk(n: SyntaxNode) {
      if (n.type === 'class_declaration') classCount++
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child)
      }
    }

    walk(node)

    if (classCount > 3) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many classes per file',
        `File has ${classCount} class declarations (max 3). Split into separate files for better maintainability.`,
        sourceCode,
        'Move each class to its own file.',
      )
    }
    return null
  },
}
