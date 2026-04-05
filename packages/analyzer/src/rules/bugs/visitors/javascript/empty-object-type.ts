import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: `{}` type annotation — matches everything except null/undefined
// This is rarely intentional and usually means the developer wanted `object` or `Record<string, unknown>`
export const emptyObjectTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-object-type',
  languages: JS_LANGUAGES,
  nodeTypes: ['type_annotation', 'type_alias_declaration', 'as_expression'],
  visit(node, filePath, sourceCode) {
    // Look for {} type (object_type with no members)
    const checkForEmptyObject = (n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null => {
      for (const child of n.namedChildren) {
        if (child.type === 'object_type') {
          // Check if it's empty (no named children = {})
          const namedChildren = child.namedChildren.filter((c) => c.type !== 'comment')
          if (namedChildren.length === 0 && child.text === '{}') {
            return child
          }
        }
      }
      return null
    }

    if (node.type === 'type_annotation') {
      const emptyObj = checkForEmptyObject(node)
      if (emptyObj) {
        return makeViolation(
          this.ruleKey, emptyObj, filePath, 'high',
          'Empty object type {}',
          '`{}` type matches everything except `null` and `undefined` — this is rarely intentional. Use `object` for non-primitive objects or `Record<string, unknown>` for generic objects.',
          sourceCode,
          'Replace `{}` with `object`, `Record<string, unknown>`, or a specific type.',
        )
      }
    }

    if (node.type === 'type_alias_declaration') {
      const typeNode = node.namedChildren.find((c) => c.type === 'object_type')
      if (typeNode) {
        const namedChildren = typeNode.namedChildren.filter((c) => c.type !== 'comment')
        if (namedChildren.length === 0 && typeNode.text === '{}') {
          return makeViolation(
            this.ruleKey, typeNode, filePath, 'high',
            'Empty object type {}',
            '`{}` type matches everything except `null` and `undefined` — use `object` or `Record<string, unknown>` instead.',
            sourceCode,
            'Replace `{}` with `object`, `Record<string, unknown>`, or a specific interface.',
          )
        }
      }
    }

    return null
  },
}
