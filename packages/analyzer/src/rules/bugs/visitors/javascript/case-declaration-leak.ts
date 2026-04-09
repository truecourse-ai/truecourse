import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const caseDeclarationLeakVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/case-declaration-leak',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_case'],
  visit(node, filePath, sourceCode) {
    // Get statements in this case (not the value field)
    const valueNode = node.childForFieldName('value')
    const statements = node.namedChildren.filter((c) => !valueNode || c.id !== valueNode.id)

    // Check if any statement is a lexical declaration not wrapped in a block
    for (const stmt of statements) {
      if (stmt.type === 'lexical_declaration') {
        const keyword = stmt.children.find((c) => c.text === 'let' || c.text === 'const')
        if (keyword) {
          return makeViolation(
            this.ruleKey, stmt, filePath, 'high',
            'Case declaration leak',
            `\`${keyword.text}\` declaration in a \`case\` clause without a block — the binding is visible in all subsequent cases.`,
            sourceCode,
            'Wrap the case body in a block: `case X: { const y = ...; break; }`.',
          )
        }
      }
      if (stmt.type === 'class_declaration') {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'high',
          'Case declaration leak',
          'Class declaration in a `case` clause without a block — the binding is visible in all subsequent cases.',
          sourceCode,
          'Wrap the case body in a block: `case X: { class Foo {} break; }`.',
        )
      }
    }
    return null
  },
}
