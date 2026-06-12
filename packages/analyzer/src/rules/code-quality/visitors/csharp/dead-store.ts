import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeViolation } from '@truecourse/shared'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, isCSharpFunctionBoundary } from './_helpers.js'

const EXIT_STATEMENT_TYPES = new Set([
  'return_statement', 'throw_statement', 'goto_statement',
  'yield_statement', 'break_statement', 'continue_statement',
])

/** Can control flow leave through this statement (early return etc.)? */
function containsExit(n: SyntaxNode): boolean {
  if (EXIT_STATEMENT_TYPES.has(n.type)) return true
  if (isCSharpFunctionBoundary(n.type)) return false
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i)
    if (child && containsExit(child)) return true
  }
  return false
}

/**
 * Straight-line dead-store detection over a method body's top-level
 * statements: a value assigned to a local and overwritten by a later
 * top-level `=` without any intervening statement mentioning the variable.
 * Mentions anywhere (conditionals, lambdas, out-args) count as reads, so the
 * linear scan stays conservative.
 */
export const csharpDeadStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dead-store',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const ruleKey = this.ruleKey
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const lastAssign = new Map<string, { assignNode: SyntaxNode; hasBeenRead: boolean }>()

    function markReadsInExpr(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const entry = lastAssign.get(n.text)
        if (entry) entry.hasBeenRead = true
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) markReadsInExpr(child)
      }
    }

    function processStmts(stmts: Array<SyntaxNode | null>): CodeViolation | null {
      for (const stmt of stmts) {
        if (!stmt) continue

        if (stmt.type === 'local_declaration_statement') {
          const decl = stmt.namedChildren.find((c) => c?.type === 'variable_declaration')
          for (const declarator of decl?.namedChildren ?? []) {
            if (declarator?.type !== 'variable_declarator') continue
            const nameNode = declarator.childForFieldName('name')
            const hasInitializer = declarator.children.some((c) => c?.type === '=')
            if (nameNode?.type === 'identifier' && hasInitializer) {
              for (let i = 0; i < declarator.namedChildCount; i++) {
                const child = declarator.namedChild(i)
                if (child && child.id !== nameNode.id) markReadsInExpr(child)
              }
              lastAssign.set(nameNode.text, { assignNode: declarator, hasBeenRead: false })
            }
          }
          continue
        }

        if (stmt.type === 'expression_statement') {
          const expr = stmt.namedChildren[0]
          if (expr?.type === 'assignment_expression') {
            const left = expr.childForFieldName('left')
            const right = expr.childForFieldName('right')
            const op = expr.childForFieldName('operator')
            if (left?.type === 'identifier' && op?.text === '=' && right) {
              const varName = left.text
              const existing = lastAssign.get(varName)
              markReadsInExpr(right)
              if (existing && !existing.hasBeenRead) {
                return makeViolation(
                  ruleKey, existing.assignNode, filePath, 'medium',
                  'Dead store',
                  `Value assigned to \`${varName}\` is overwritten before being read.`,
                  sourceCode,
                  'Remove the dead assignment or use the value before overwriting it.',
                )
              }
              lastAssign.set(varName, { assignNode: expr, hasBeenRead: false })
              continue
            }
          }
        }

        markReadsInExpr(stmt)
        // After a statement that can exit the method (early return inside an
        // if, a throw, …) the "previous assignment" may be the value the
        // caller observed — stop tracking rather than report a false store.
        if (containsExit(stmt)) lastAssign.clear()
      }
      return null
    }

    return processStmts(bodyNode.namedChildren)
  },
}
