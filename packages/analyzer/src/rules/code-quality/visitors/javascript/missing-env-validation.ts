import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingEnvValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-env-validation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')
    if (!obj || !prop) return null

    if (obj.type !== 'member_expression') return null
    const envObj = obj.childForFieldName('object')
    const envProp = obj.childForFieldName('property')
    if (!envObj || !envProp) return null
    if (envObj.text !== 'process' || envProp.text !== 'env') return null

    const envVarName = prop.text
    if (!envVarName || envVarName === 'env') return null

    let ancestor = node.parent
    let depth = 0
    while (ancestor && depth < 5) {
      const t = ancestor.type
      if (t === 'if_statement' || t === 'binary_expression' || t === 'ternary_expression'
        || t === 'logical_expression') {
        return null
      }
      ancestor = ancestor.parent
      depth++
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      `Unvalidated env var: process.env.${envVarName}`,
      `\`process.env.${envVarName}\` is used without checking if it's defined — it may be \`undefined\` at runtime.`,
      sourceCode,
      `Add a guard: \`const val = process.env.${envVarName}; if (!val) throw new Error('${envVarName} is required');\``,
    )
  },
}
