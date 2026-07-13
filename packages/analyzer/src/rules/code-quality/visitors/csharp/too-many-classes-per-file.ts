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
    //
    // Only TOP-LEVEL classes are counted: a nested class is part of its outer
    // type, not a separate file-worth of code. Counting nested types flagged
    // idiomatic single-purpose files — an outer holder whose nested static
    // classes namespace constants/permissions/error-codes (e.g. `Foo { Bar {…},
    // Baz {…} }`) — that cannot and should not be split into one file per class.
    function walk(n: SyntaxNode, insideClass: boolean) {
      if (n.type === 'class_declaration') {
        if (!insideClass) classCount++
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) walk(child, true)
        }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child, insideClass)
      }
    }

    walk(node, false)

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
