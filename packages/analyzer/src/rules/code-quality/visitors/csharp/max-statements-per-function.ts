import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, CSHARP_STATEMENT_TYPES, getCSharpFunctionName } from './_helpers.js'

const MAX_STATEMENTS = 30

export const csharpMaxStatementsPerFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-statements-per-function',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    let count = 0
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i)
      if (child && CSHARP_STATEMENT_TYPES.has(child.type)) count++
    }
    if (count <= MAX_STATEMENTS) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Method has ${count} statements`,
      `Method \`${name}\` has ${count} statements — maximum is ${MAX_STATEMENTS}. Break it into smaller methods.`,
      sourceCode,
      'Extract groups of related statements into smaller helper methods.',
    )
  },
}
