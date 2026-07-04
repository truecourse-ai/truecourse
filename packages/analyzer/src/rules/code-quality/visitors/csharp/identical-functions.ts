import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpFunctionName } from './_helpers.js'

const COMPARED_TYPES = new Set(['method_declaration', 'local_function_statement', 'constructor_declaration'])

/**
 * A "trivial" returned expression carries no real computation: a literal,
 * `default`, `this`, a bare identifier or member access, or a call whose
 * arguments are themselves all trivial (`Task.FromResult(true)`,
 * `Task.CompletedTask`). Two functions sharing such a body — framework
 * default hooks, null-object stubs — are idiomatically identical with nothing
 * worth extracting, so they must not be reported as duplication.
 */
function isTrivialExpr(e: SyntaxNode): boolean {
  switch (e.type) {
    case 'integer_literal':
    case 'real_literal':
    case 'boolean_literal':
    case 'string_literal':
    case 'verbatim_string_literal':
    case 'null_literal':
    case 'character_literal':
    case 'identifier':
    case 'this_expression':
    case 'default_expression':
    case 'member_access_expression':
      return true
    case 'invocation_expression': {
      const args = e.childForFieldName('arguments')
      if (!args) return true
      return args.namedChildren.every((a) => {
        if (a?.type !== 'argument') return true
        const value = a.namedChildren.find((c) => c && c.type !== 'name_colon')
        return !value || isTrivialExpr(value)
      })
    }
    default:
      return false
  }
}

/** A block body that is a single `return` of a trivial expression (or bare `return;`). */
function isTrivialReturnBody(body: SyntaxNode): boolean {
  const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
  if (stmts.length !== 1 || stmts[0]?.type !== 'return_statement') return false
  const expr = stmts[0].namedChildren.find((c) => c && c.type !== 'comment')
  return !expr || isTrivialExpr(expr)
}

export const csharpIdenticalFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/identical-functions',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const bodies: Array<{ body: string; fnNode: SyntaxNode }> = []

    function walk(n: SyntaxNode) {
      if (COMPARED_TYPES.has(n.type)) {
        const body = n.childForFieldName('body')
        // Expression-bodied members (`=> _inner.Count`) are one-expression
        // delegators — identical text there is idiomatic, not duplication.
        if (body && body.type === 'block' && body.namedChildCount > 0) {
          // A single `throw` body is an intentional stub
          // (NotImplementedException etc.) — skip.
          const onlyThrow = body.namedChildCount === 1 && body.namedChildren[0]?.type === 'throw_statement'
          if (!onlyThrow && !isTrivialReturnBody(body)) {
            const normalized = body.text.replace(/\s+/g, ' ').trim()
            bodies.push({ body: normalized, fnNode: n })
          }
        }
        if (body) {
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (child) walk(child)
          }
        }
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i]!.body === bodies[j]!.body && bodies[i]!.body.length > 10) {
          const nameA = getCSharpFunctionName(bodies[i]!.fnNode)
          const nameB = getCSharpFunctionName(bodies[j]!.fnNode)
          return makeViolation(
            this.ruleKey, bodies[i]!.fnNode, filePath, 'medium',
            'Identical method bodies',
            `Methods \`${nameA}\` and \`${nameB}\` have identical bodies. Extract to a shared method.`,
            sourceCode,
            'Extract the shared logic into a helper method and call it from both places.',
          )
        }
      }
    }
    return null
  },
}
