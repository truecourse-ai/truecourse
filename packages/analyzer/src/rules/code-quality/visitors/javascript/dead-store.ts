import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeViolation } from '@truecourse/shared'

export const deadStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dead-store',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const ruleKey = this.ruleKey
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const lastAssign = new Map<string, { assignNode: SyntaxNode; hasBeenRead: boolean }>()

    function markRead(name: string) {
      const entry = lastAssign.get(name)
      if (entry) entry.hasBeenRead = true
    }

    function markReadsInExpr(n: SyntaxNode) {
      if (n.type === 'identifier') markRead(n.text)
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) markReadsInExpr(child)
      }
    }

    // A value is "trivially dead" only when it is a simple literal with no
    // side effects. Function calls, tagged templates, `new` expressions, object
    // and array constructors, and the `null` sentinel are all common
    // intentional pre-initialization patterns (typed-init, SQL-fragment
    // placeholders, etc.) and must not be flagged.
    function isTrackableInitial(value: SyntaxNode): boolean {
      switch (value.type) {
        case 'number':
        case 'string':
        case 'template_string':
        case 'true':
        case 'false':
        case 'regex':
          return true
        default:
          return false
      }
    }

    function processStmts(stmts: SyntaxNode[]): CodeViolation | null {
      for (const stmt of stmts) {
        if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
          for (const decl of stmt.namedChildren) {
            if (decl.type === 'variable_declarator') {
              const nameNode = decl.childForFieldName('name')
              const value = decl.childForFieldName('value')
              if (nameNode?.type === 'identifier') {
                if (value) markReadsInExpr(value)
                // Only track declarations whose initial value is a trivial
                // literal — otherwise the "dead" value may carry side effects
                // or be an intentional sentinel.
                if (value && isTrackableInitial(value)) {
                  lastAssign.set(nameNode.text, { assignNode: decl, hasBeenRead: false })
                } else {
                  lastAssign.delete(nameNode.text)
                }
              }
            }
          }
          continue
        }

        if (stmt.type === 'expression_statement') {
          const expr = stmt.namedChildren[0]
          if (expr?.type === 'assignment_expression') {
            const left = expr.childForFieldName('left')
            const right = expr.childForFieldName('right')
            const opNode = expr.children.find((c) => c.type === '=')
            if (left?.type === 'identifier' && opNode && right) {
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
              if (isTrackableInitial(right)) {
                lastAssign.set(varName, { assignNode: expr, hasBeenRead: false })
              } else {
                lastAssign.delete(varName)
              }
              continue
            }
          }
        }

        markReadsInExpr(stmt)
      }
      return null
    }

    return processStmts(bodyNode.namedChildren)
  },
}
