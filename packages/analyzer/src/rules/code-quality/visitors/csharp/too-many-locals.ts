import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const MAX_LOCALS = 15

export const csharpTooManyLocalsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-locals',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const locals = new Set<string>()

    const params = node.childForFieldName('parameters')
    if (params) {
      for (const param of params.namedChildren) {
        const name = param?.childForFieldName('name')?.text
        if (name) locals.add(name)
      }
    }

    function collect(n: SyntaxNode) {
      // Lambda / local-function bodies declare their own locals.
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (n.type === 'variable_declarator' || n.type === 'declaration_expression') {
        const name = n.childForFieldName('name')?.text
        if (name && name !== '_') locals.add(name)
      }
      if (n.type === 'foreach_statement') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text !== '_') locals.add(left.text)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collect(child)
      }
    }

    collect(body)

    if (locals.size > MAX_LOCALS) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many local variables',
        `Method \`${name}\` has ${locals.size} local variables (threshold: ${MAX_LOCALS}). This indicates the method is doing too much.`,
        sourceCode,
        'Extract related logic into helper methods or group related values into a record/class.',
      )
    }
    return null
  },
}
