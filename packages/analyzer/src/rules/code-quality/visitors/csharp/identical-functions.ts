import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpFunctionName } from './_helpers.js'

const COMPARED_TYPES = new Set(['method_declaration', 'local_function_statement', 'constructor_declaration'])

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
          if (!onlyThrow) {
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
