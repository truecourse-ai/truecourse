import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const explicitAnyInReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/explicit-any-in-return',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Look for return type annotation `: any`
    // In tree-sitter TS, return type is a type_annotation child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === 'type_annotation') {
        const typeNode = child.namedChildren[0]
        if (typeNode?.type === 'predefined_type' && typeNode.text === 'any') {
          // Respect explicit eslint suppression on the preceding line(s).
          // The canonical pattern is:
          //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
          //   export function foo(): any { ... }
          // When the developer has explicitly disabled the upstream ESLint
          // rule for this declaration, honor that suppression instead of
          // reporting a duplicate violation.
          const startLine = node.startPosition.row
          const sourceLines = sourceCode.split('\n')
          // Look up to 2 lines above the function start for a suppression
          // comment (allows for an intervening decorator/blank line).
          for (let l = startLine - 1; l >= Math.max(0, startLine - 2); l--) {
            const line = sourceLines[l] ?? ''
            if (/eslint-disable(?:-next-line)?[^\n]*no-explicit-any/.test(line)) {
              return null
            }
            // Stop scanning once we hit a non-comment, non-blank line.
            const trimmed = line.trim()
            if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
              break
            }
          }
          const nameNode = node.childForFieldName('name')
          return makeViolation(
            this.ruleKey, child, filePath, 'medium',
            `Explicit \`any\` return type`,
            `Function \`${nameNode?.text ?? 'anonymous'}\` has explicit \`: any\` return type. Specify a concrete return type.`,
            sourceCode,
            'Replace `: any` return type with a specific type.',
          )
        }
      }
    }
    return null
  },
}
