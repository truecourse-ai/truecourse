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

    // ------------------------------------------------------------------
    // Structural FP suppressions (parent-chain inspection)
    // ------------------------------------------------------------------

    // 1. Non-null assertion: `process.env.X!` — author explicitly asserts presence.
    //    AST: member_expression → non_null_expression
    if (node.parent?.type === 'non_null_expression') return null

    // 2. Boolean presence-check: `!process.env.X` or `!!process.env.X` — value
    //    is coerced to boolean, never consumed as a string. Common feature-flag idiom.
    //    AST: member_expression → unary_expression (operator "!")
    if (node.parent?.type === 'unary_expression') {
      const opChild = node.parent.child(0)
      if (opChild && opChild.text === '!') return null
    }

    // 3. Explicit Boolean/String coercion: `Boolean(process.env.X)`, `String(process.env.X)`.
    //    AST: member_expression → arguments → call_expression
    if (node.parent?.type === 'arguments' && node.parent.parent?.type === 'call_expression') {
      const callee = node.parent.parent.childForFieldName('function')
      if (callee && (callee.text === 'Boolean' || callee.text === 'String')) return null
    }

    // 4. Template-literal substitution: `${process.env.X}/path` — env appears inside
    //    a template; this is a runtime composition, not an unvalidated bare read.
    //    Authors rely on the deployment to set the prefix; downstream URL parsing
    //    will fail loudly anyway.
    //    AST: member_expression → template_substitution
    if (node.parent?.type === 'template_substitution') return null

    // 5. Top-level exported config constant:
    //      export const X = process.env.Y;
    //      // or
    //      const X = process.env.Y;
    //      export { X };
    //    These are config-surface declarations whose callers validate at point of use.
    //    AST: member_expression → variable_declarator → lexical_declaration →
    //         (a) export_statement → program  (inline export const)
    //         (b) program, then a later sibling export_statement names the binding
    if (node.parent?.type === 'variable_declarator') {
      const declarator = node.parent
      const lexDecl = declarator.parent
      if (lexDecl?.type === 'lexical_declaration') {
        const lexParent = lexDecl.parent
        // (a) inline `export const X = process.env.Y`
        if (lexParent?.type === 'export_statement' && lexParent.parent?.type === 'program') {
          return null
        }
        // (b) `const X = process.env.Y; ... export { X }`
        if (lexParent?.type === 'program') {
          const nameNode = declarator.childForFieldName('name')
          const bindingName = nameNode?.type === 'identifier' ? nameNode.text : null
          if (bindingName) {
            const program = lexParent
            for (let i = 0; i < program.childCount; i++) {
              const sib = program.child(i)
              if (!sib || sib.type !== 'export_statement') continue
              // Look for `export_clause` listing this identifier (e.g. `export { X };`)
              for (let j = 0; j < sib.childCount; j++) {
                const sc = sib.child(j)
                if (sc?.type !== 'export_clause') continue
                for (let k = 0; k < sc.childCount; k++) {
                  const spec = sc.child(k)
                  if (spec?.type !== 'export_specifier') continue
                  const specName = spec.childForFieldName('name')
                  if (specName?.text === bindingName) return null
                }
              }
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Existing ancestor walk: skip when env access is part of an
    // if/binary/ternary/logical expression (validation in place).
    // ------------------------------------------------------------------

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
    // Find the variable name this env access is assigned to.
    // AST: node (member_expression: process.env.X) → parent is variable_declarator
    let assignTarget: string | null = null
    const directParent = node.parent
    if (directParent?.type === 'variable_declarator') {
      assignTarget = directParent.childForFieldName('name')?.text ?? null
    }
    // Also check direct assignment: varName = process.env.X
    if (!assignTarget && directParent?.type === 'assignment_expression') {
      const left = directParent.childForFieldName('left')
      if (left?.type === 'identifier') assignTarget = left.text
    }
    // Also check destructured or nested: const { X } = process.env or other patterns
    // where the parent is something else but grandparent is a variable_declarator
    if (!assignTarget && directParent?.parent?.type === 'variable_declarator') {
      assignTarget = directParent.parent.childForFieldName('name')?.text ?? null
    }
    if (assignTarget) {
      const lines = sourceCode.split('\n')
      for (let i = 0; i < lines.length; i++) {
        // Check if there's an if-statement referencing the assigned variable with throw/return
        if (/\bif\s*\(/.test(lines[i]) && lines[i].includes(assignTarget)) {
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            if (/\b(throw|return)\b/.test(lines[j])) return null
          }
        }
        // Also check: bare `if (!assignTarget)` on one line and throw/return on the next
        const negCheck = new RegExp(`if\\s*\\(\\s*!\\s*${assignTarget}\\b`)
        if (negCheck.test(lines[i])) {
          for (let j = i; j < Math.min(i + 10, lines.length); j++) {
            if (/\b(throw|return)\b/.test(lines[j])) return null
          }
        }
        // Also check: ternary or logical-OR validation: assignTarget || throw/default
        if (lines[i].includes(assignTarget) && /\|\||&&|\?\?/.test(lines[i])) {
          if (/\b(throw|return)\b/.test(lines[i])) return null
        }
      }
    }

    // Final fallback: search for ANY if-statement that references the env var name
    // (by variable or env var name) followed by throw/return within 10 lines
    {
      const lines = sourceCode.split('\n')
      const searchTerms = [envVarName]
      if (assignTarget) searchTerms.push(assignTarget)
      for (const term of searchTerms) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(term) && (/!\s*\w/.test(lines[i]) || /===?\s*undefined/.test(lines[i]) || /==\s*null/.test(lines[i]))) {
            for (let j = i; j < Math.min(i + 10, lines.length); j++) {
              if (/\b(throw|return|process\.exit)\b/.test(lines[j])) return null
            }
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
