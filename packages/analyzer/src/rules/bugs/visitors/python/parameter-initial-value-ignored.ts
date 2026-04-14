import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonParameterInitialValueIgnoredVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/parameter-initial-value-ignored',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Collect parameters that have defaults
    const paramsWithDefaults = new Set<string>()
    for (const child of params.namedChildren) {
      if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
        const pname = child.childForFieldName('name')
        if (pname) paramsWithDefaults.add(pname.text)
      }
    }
    if (paramsWithDefaults.size === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment' && c.type !== 'expression_statement' || (c.type === 'expression_statement' && c.text !== '...'))
    if (statements.length === 0) return null

    // Check if the very first statement is an unconditional assignment to a parameter with a default
    const first = statements[0]
    if (first.type !== 'expression_statement') return null
    const expr = first.namedChildren[0]
    if (!expr || expr.type !== 'assignment') return null

    const left = expr.childForFieldName('left')
    if (!left || left.type !== 'identifier') return null
    const assignedName = left.text

    if (paramsWithDefaults.has(assignedName)) {
      return makeViolation(
        this.ruleKey, expr, filePath, 'medium',
        'Function parameter initial value ignored',
        `Parameter \`${assignedName}\` is immediately overwritten at the start of the function — the default value is never used.`,
        sourceCode,
        `Remove the default value from the parameter signature, or use the parameter instead of overwriting it.`,
      )
    }
    return null
  },
}
