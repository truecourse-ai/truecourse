import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const missingEnvValidationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-env-validation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    // Skip build/tool configuration files — these run at build time, not runtime
    const fileName = filePath.split('/').pop() || ''
    if (/^drizzle\.config\.|\.config\.(ts|js|mjs|cjs)$/.test(fileName)) return null

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

    // Check for if-throw validation pattern in the surrounding scope.
    // Pattern: `if (!process.env.VAR) throw ...` or `if (process.env.VAR === undefined) throw ...`
    // Walk up to find the containing block (function body or program) and scan siblings.
    let container = node.parent
    while (container && container.type !== 'statement_block' && container.type !== 'program') {
      container = container.parent
    }
    if (container) {
      for (let i = 0; i < container.namedChildCount; i++) {
        const stmt = container.namedChild(i)
        if (!stmt || stmt.type !== 'if_statement') continue
        const condition = stmt.childForFieldName('condition')
        if (!condition) continue
        // Check if the condition references this env var
        if (!condition.text.includes(envVarName)) continue
        // Check if the if body contains a throw
        const ifBody = stmt.childForFieldName('consequence')
        if (!ifBody) continue
        const hasThrow = ifBody.type === 'throw_statement' ||
          (ifBody.namedChildren && ifBody.namedChildren.some(c => c.type === 'throw_statement'))
        if (hasThrow) return null
      }
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
