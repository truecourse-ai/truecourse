import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const inconsistentReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/inconsistent-return',
  languages: JS_LANGUAGES,
  nodeTypes: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    let body: SyntaxNode | null = null

    if (node.type === 'method_definition') {
      body = node.childForFieldName('body')
    } else if (node.type === 'arrow_function') {
      body = node.childForFieldName('body')
      // Arrow function with expression body always returns — skip
      if (body && body.type !== 'statement_block') return null
    } else {
      body = node.childForFieldName('body')
    }

    if (!body || body.type !== 'statement_block') return null

    // Skip constructor, setter — they can have inconsistent returns by design
    if (node.type === 'method_definition') {
      const name = node.childForFieldName('name')
      if (name?.text === 'constructor') return null
      // Skip setters
      if (node.children.some((c) => c.text === 'set' && c.type !== 'property_identifier')) return null
    }

    let hasValueReturn = false
    let hasVoidReturn = false

    function scanReturns(n: SyntaxNode) {
      if (n.type === 'return_statement') {
        if (n.namedChildren.length > 0) {
          hasValueReturn = true
        } else {
          hasVoidReturn = true
        }
        return
      }
      // Don't recurse into nested function bodies
      if (
        n !== body &&
        (n.type === 'function_declaration' || n.type === 'function' || n.type === 'arrow_function' || n.type === 'method_definition')
      ) return

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) scanReturns(child)
      }
    }

    scanReturns(body)

    // Also detect fall-through: if the function has return-with-value paths but the last statement
    // in the body is NOT a terminal (return/throw), the function can fall through returning undefined
    if (hasValueReturn && !hasVoidReturn) {
      const bodyStatements = body.namedChildren.filter((c) => c.type !== 'comment')
      if (bodyStatements.length > 0) {
        const last = bodyStatements[bodyStatements.length - 1]
        const TERMINALS = new Set(['return_statement', 'throw_statement'])

        // Check if the last statement terminates all paths
        function isTerminal(stmt: SyntaxNode): boolean {
          if (TERMINALS.has(stmt.type)) return true
          // try_statement: terminates if all try+catch blocks terminate
          if (stmt.type === 'try_statement') {
            const tryBlock = stmt.namedChildren.find((c) => c.type === 'statement_block')
            const catchClause = stmt.namedChildren.find((c) => c.type === 'catch_clause')
            const finallyClause = stmt.namedChildren.find((c) => c.type === 'finally_clause')

            // If there's a finally with a terminal, the whole thing terminates
            if (finallyClause) {
              const finallyBlock = finallyClause.namedChildren.find((c) => c.type === 'statement_block')
              if (finallyBlock) {
                const finStatements = finallyBlock.namedChildren.filter((c) => c.type !== 'comment')
                if (finStatements.length > 0 && TERMINALS.has(finStatements[finStatements.length - 1].type)) return true
              }
            }

            // try+catch both must terminate
            if (tryBlock && catchClause) {
              const tryStatements = tryBlock.namedChildren.filter((c) => c.type !== 'comment')
              const tryTerminates = tryStatements.length > 0 && isTerminal(tryStatements[tryStatements.length - 1])

              const catchBody = catchClause.namedChildren.find((c) => c.type === 'statement_block')
              const catchStatements = catchBody?.namedChildren.filter((c) => c.type !== 'comment') ?? []
              const catchTerminates = catchStatements.length > 0 && isTerminal(catchStatements[catchStatements.length - 1])

              return tryTerminates && catchTerminates
            }
            return false
          }
          return false
        }

        if (!isTerminal(last)) {
          hasVoidReturn = true // implicit void return at end of function
        }
      }
    }

    if (hasValueReturn && hasVoidReturn) {
      const namePart = node.type === 'function_declaration'
        ? (node.childForFieldName('name')?.text ?? 'function')
        : node.type === 'method_definition'
          ? (node.childForFieldName('name')?.text ?? 'method')
          : 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inconsistent return',
        `\`${namePart}\` sometimes returns a value and sometimes falls through without returning — callers receive \`undefined\` on the no-return paths.`,
        sourceCode,
        'Ensure all code paths either return a value or none of them do.',
      )
    }

    return null
  },
}
