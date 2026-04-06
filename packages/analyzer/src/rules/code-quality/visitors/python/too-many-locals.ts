import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const MAX_LOCALS = 15

function collectLocalNames(body: SyntaxNode, locals: Set<string>) {
  for (const outer of body.namedChildren) {
    // Body children are expression_statement wrapping the actual statement
    const stmt = outer.type === 'expression_statement' ? (outer.namedChildren[0] ?? outer) : outer
    if (stmt.type === 'assignment' || stmt.type === 'annotated_assignment') {
      const left = stmt.childForFieldName('left')
      if (left?.type === 'identifier') locals.add(left.text)
      if (left?.type === 'tuple') {
        for (const item of left.namedChildren) {
          if (item.type === 'identifier') locals.add(item.text)
        }
      }
    }
    if (stmt.type === 'for_statement') {
      const left = stmt.childForFieldName('left')
      if (left?.type === 'identifier') locals.add(left.text)
    }
    if (stmt.type === 'with_statement') {
      // with x as y
      for (const item of stmt.children) {
        if (item.type === 'as_pattern' || item.type === 'with_item') {
          const alias = item.namedChildren[item.namedChildren.length - 1]
          if (alias?.type === 'identifier') locals.add(alias.text)
        }
      }
    }
  }
}

export const pythonTooManyLocalsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-locals',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    const body = node.childForFieldName('body')
    if (!body) return null

    const locals = new Set<string>()

    // Collect parameters
    if (params) {
      for (const param of params.namedChildren) {
        if (param.type === 'identifier') locals.add(param.text)
        if (param.type === 'typed_parameter' || param.type === 'default_parameter') {
          const name = param.namedChildren[0]
          if (name?.type === 'identifier') locals.add(name.text)
        }
      }
    }

    collectLocalNames(body, locals)

    if (locals.size > MAX_LOCALS) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many local variables',
        `Function \`${name}\` has ${locals.size} local variables (threshold: ${MAX_LOCALS}). This indicates the function is doing too much.`,
        sourceCode,
        'Extract related logic into helper functions or use data classes/named tuples to group related variables.',
      )
    }

    return null
  },
}
