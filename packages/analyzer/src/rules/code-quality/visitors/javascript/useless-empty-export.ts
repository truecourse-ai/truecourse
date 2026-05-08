import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessEmptyExportVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-empty-export',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    const namedExports = node.namedChildren.find((c) => c.type === 'named_exports' || c.type === 'export_clause')
    if (!namedExports) return null

    if (namedExports.namedChildCount === 0) {
      // Skip when the file has no other imports/exports and contains
      // top-level statements that mutate globals — \`export {}\` is
      // required to mark a side-effect script as a module so TS
      // doesn't treat it as ambient. Polyfills (\`globalThis.X = ...\`,
      // \`window.X = ...\`) are the canonical case.
      const program = node.parent
      if (program?.type === 'program') {
        let hasOtherModuleSyntax = false
        let hasGlobalMutation = false
        for (let i = 0; i < program.namedChildCount; i++) {
          const stmt = program.namedChild(i)
          if (!stmt) continue
          if (stmt.id === node.id) continue
          if (stmt.type === 'import_statement') hasOtherModuleSyntax = true
          if (stmt.type === 'export_statement') hasOtherModuleSyntax = true
          // \`globalThis.X = ...\` / \`window.X = ...\` / \`global.X = ...\`
          // / \`Symbol.X = ...\` at top level is a polyfill.
          if (stmt.type === 'expression_statement') {
            const inner = stmt.namedChild(0)
            if (inner?.type === 'assignment_expression') {
              const left = inner.childForFieldName('left')
              if (left?.type === 'member_expression') {
                const obj = left.childForFieldName('object')?.text ?? ''
                if (/^(?:globalThis|window|global|self|Symbol|Promise|Object|Array|Map|Set)$/.test(obj)) {
                  hasGlobalMutation = true
                }
              }
            }
          }
        }
        if (!hasOtherModuleSyntax && hasGlobalMutation) return null
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless empty export',
        '`export {}` does nothing useful. Remove it unless it is needed to mark the file as a module.',
        sourceCode,
        'Remove the empty `export {}` statement.',
      )
    }
    return null
  },
}
