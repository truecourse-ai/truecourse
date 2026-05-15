import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_annotation'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.namedChildren[0]
    if (!typeNode) return null
    if (typeNode.type === 'predefined_type' && typeNode.text === 'any') {
      // Respect explicit ESLint suppression at the source. The canonical
      // patterns are:
      //   // eslint-disable-next-line @typescript-eslint/no-explicit-any
      //   function foo(x: any) {}
      // and inline:
      //   function foo(x: any) {} // eslint-disable-line @typescript-eslint/no-explicit-any
      // When the developer has explicitly disabled the upstream rule for
      // this site, honor that suppression rather than emit a duplicate.
      const startLine = node.startPosition.row
      const sourceLines = sourceCode.split('\n')
      const suppressionRe = /eslint-disable(?:-next-line|-line)?[^\n]*no-explicit-any/
      // Check the line of the `: any` itself (covers inline disables and
      // multi-param signatures where the suppression sits on the parent line).
      if (suppressionRe.test(sourceLines[startLine] ?? '')) return null
      // Walk upward through contiguous comment/blank lines for a preceding
      // suppression comment. Stop at the first line of real code above.
      for (let l = startLine - 1; l >= 0; l--) {
        const line = sourceLines[l] ?? ''
        if (suppressionRe.test(line)) return null
        const trimmed = line.trim()
        if (trimmed === '') continue
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
        break
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Explicit `any` type',
        'Using `: any` bypasses TypeScript type checking. Use a specific type or `unknown` instead.',
        sourceCode,
        'Replace `: any` with a specific type or `unknown`.',
      )
    }
    return null
  },
}
