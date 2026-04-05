import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateHandlerExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-handler-exception',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Collect all except clause exception types across the try block
    const seenAcross = new Set<string>()

    for (const child of node.namedChildren) {
      if (child.type !== 'except_clause') continue

      // Check for duplicates within a single except clause (e.g. except (E, E):)
      const children = child.children
      // Find the exception type list — it may be a tuple or a single identifier
      const typeNode = children.find((c) =>
        c.type === 'identifier' || c.type === 'tuple' || c.type === 'dotted_name' || c.type === 'attribute'
      )
      if (!typeNode) continue

      if (typeNode.type === 'tuple') {
        const seen = new Set<string>()
        for (const item of typeNode.namedChildren) {
          const name = item.text
          if (seen.has(name)) {
            return makeViolation(
              this.ruleKey, child, filePath, 'medium',
              'Duplicate exception in handler',
              `Exception \`${name}\` appears more than once in the except clause — the duplicate is unreachable.`,
              sourceCode,
              `Remove the duplicate \`${name}\` from the except clause.`,
            )
          }
          seen.add(name)
        }
      }

      // Check for the same exception type across multiple except clauses
      const typeName = typeNode.text
      if (seenAcross.has(typeName)) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Duplicate exception in handler',
          `Exception \`${typeName}\` is caught by an earlier except clause — this handler is unreachable.`,
          sourceCode,
          `Remove the duplicate except clause for \`${typeName}\`.`,
        )
      }
      seenAcross.add(typeName)
    }

    return null
  },
}
