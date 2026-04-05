import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateClassFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-class-field',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const seenNames = new Map<string, number>()
    const violations: ReturnType<typeof makeViolation>[] = []

    for (const outerStmt of body.namedChildren) {
      // Class body children are expression_statement wrapping assignment
      const stmt = outerStmt.type === 'expression_statement' ? outerStmt.namedChildren[0] : outerStmt
      if (!stmt) continue
      // Direct assignment: field = value
      if (stmt.type === 'assignment' || stmt.type === 'annotated_assignment') {
        const target = stmt.childForFieldName('left') ?? stmt.namedChildren[0]
        if (target && target.type === 'identifier') {
          const name = target.text
          if (seenNames.has(name)) {
            const v = makeViolation(
              this.ruleKey, stmt, filePath, 'medium',
              'Duplicate class field definition',
              `Field \`${name}\` is defined multiple times in the class body. The earlier definition is dead code.`,
              sourceCode,
              'Remove the duplicate definition or rename one of them.',
            )
            if (v) violations.push(v)
          } else {
            seenNames.set(name, 1)
          }
        }
      }
    }

    return violations.length > 0 ? violations[0] : null
  },
}
