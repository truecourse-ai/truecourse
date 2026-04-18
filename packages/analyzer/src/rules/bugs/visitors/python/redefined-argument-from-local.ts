import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects for-loop or with variables that redefine function parameters.
 * Once the loop/with runs, the original parameter value is lost.
 */
export const pythonRedefinedArgumentFromLocalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redefined-argument-from-local',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    const body = node.childForFieldName('body')

    if (!params || !body) return null

    // Collect parameter names
    const paramNames = new Set<string>()
    for (const param of params.namedChildren) {
      if (param.type === 'identifier') {
        paramNames.add(param.text)
      } else if (
        param.type === 'default_parameter' ||
        param.type === 'typed_parameter' ||
        param.type === 'typed_default_parameter'
      ) {
        const name = param.childForFieldName('name') ?? param.namedChildren[0]
        if (name?.type === 'identifier') paramNames.add(name.text)
      }
    }

    if (paramNames.size === 0) return null

    // Find for-loop variables or with-statement variables that match a parameter
    function findRedefinition(
      n: import('tree-sitter').SyntaxNode,
    ): { node: import('tree-sitter').SyntaxNode; paramName: string; context: string } | null {
      if (n.type === 'for_statement') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && paramNames.has(left.text)) {
          return { node: left, paramName: left.text, context: 'for loop' }
        }
      }

      if (n.type === 'with_statement') {
        // with expr as varname — check the alias
        for (const clause of n.namedChildren) {
          if (clause.type === 'with_clause' || clause.type === 'with_item') {
            const alias = clause.childForFieldName('alias')
            if (alias?.type === 'identifier' && paramNames.has(alias.text)) {
              return { node: alias, paramName: alias.text, context: 'with statement' }
            }
          }
        }
        // Also check as_pattern directly
        for (const child of n.namedChildren) {
          if (child.type === 'as_pattern') {
            const alias = child.namedChildren[1]
            if (alias?.type === 'identifier' && paramNames.has(alias.text)) {
              return { node: alias, paramName: alias.text, context: 'with statement' }
            }
          }
        }
      }

      // Don't descend into nested function definitions
      if (n.id !== body?.id && (n.type === 'function_definition' || n.type === 'class_definition')) return null

      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const result = findRedefinition(child)
          if (result) return result
        }
      }

      return null
    }

    const result = findRedefinition(body)
    if (!result) return null

    const funcName = node.childForFieldName('name')?.text ?? 'function'

    return makeViolation(
      this.ruleKey, result.node, filePath, 'medium',
      'Loop variable redefines function parameter',
      `\`${result.paramName}\` in the ${result.context} redefines the function parameter \`${result.paramName}\` in \`${funcName}\` — the original parameter value is lost after the ${result.context}.`,
      sourceCode,
      `Rename the ${result.context} variable to avoid shadowing the parameter \`${result.paramName}\`.`,
    )
  },
}
