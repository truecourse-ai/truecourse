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

    // Check for if-throw/return validation pattern ANYWHERE in the source code.
    // Broad text search: if the file contains an if-statement referencing the env var name
    // together with a throw or return, the variable is validated somewhere.
    // This catches patterns like:
    //   const dbUrl = process.env.DATABASE_URL
    //   if (!dbUrl) throw new Error('...')
    // as well as validation functions, guard clauses, etc.
    const envVarRegex = new RegExp(
      // Match: env var name appears near an if + throw/return within a reasonable range
      `(?:if\\s*\\([^)]*\\b${envVarName}\\b|\\b${envVarName}\\b[^;]*(?:if\\s*\\())`,
    )
    if (envVarRegex.test(sourceCode)) {
      // Found a reference to the env var in an if-condition somewhere in the file.
      // Now check if there's also a throw or return near it.
      const lines = sourceCode.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(envVarName) && /\bif\s*\(/.test(lines[i])) {
          // Check the next few lines for throw/return
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (/\b(throw|return)\b/.test(lines[j])) return null
          }
        }
        // Also check: if statement on one line, env var referenced in condition
        if (/\bif\s*\(/.test(lines[i]) && lines[i].includes(envVarName)) {
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (/\b(throw|return)\b/.test(lines[j])) return null
          }
        }
      }
    }

    // Also check: variable assigned from env, then validated with if(!var) throw/return
    // Pattern: const/let varName = process.env.ENVVAR; ... if (!varName) throw/return
    // Find the variable name this env access is assigned to
    let assignTarget: string | null = null
    const varDeclarator = node.parent?.parent // member_expression → member_expression (process.env.X) → variable_declarator
    if (varDeclarator?.type === 'variable_declarator') {
      assignTarget = varDeclarator.childForFieldName('name')?.text ?? null
    }
    // Also check direct assignment: varName = process.env.X
    if (!assignTarget && node.parent?.parent?.type === 'assignment_expression') {
      const left = node.parent.parent.childForFieldName('left')
      if (left?.type === 'identifier') assignTarget = left.text
    }
    if (assignTarget) {
      const lines = sourceCode.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Check if there's an if-statement referencing the assigned variable with throw/return
        if (/\bif\s*\(/.test(lines[i]) && lines[i].includes(assignTarget)) {
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            if (/\b(throw|return)\b/.test(lines[j])) return null
          }
        }
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
