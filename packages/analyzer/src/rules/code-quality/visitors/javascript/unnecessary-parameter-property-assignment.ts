import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * @typescript-eslint/no-unnecessary-parameter-property-assignment
 * Detects constructor parameter properties that are also assigned in the constructor body
 * with the same value, making the assignment redundant.
 *
 * e.g.:
 *   constructor(public name: string = 'default') {
 *     this.name = 'default'  // redundant — same as parameter default
 *   }
 */
export const unnecessaryParameterPropertyAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-parameter-property-assignment',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['method_definition'],
  visit(node, filePath, sourceCode) {
    // Only check constructors
    const nameNode = node.childForFieldName('name')
    if (nameNode?.text !== 'constructor') return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Find parameter properties (public/private/protected/readonly parameters)
    const paramProps = new Map<string, string>() // name → default value text
    for (const param of params.namedChildren) {
      // TypeScript parameter property has accessibility modifiers
      if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
        const hasModifier = param.children.some((c) =>
          c.type === 'accessibility_modifier' || c.type === 'readonly'
        )
        if (!hasModifier) continue

        const nameChild = param.childForFieldName('pattern') ?? param.namedChildren.find((c) => c.type === 'identifier')
        const defaultVal = param.childForFieldName('value')
        if (nameChild?.type === 'identifier') {
          paramProps.set(nameChild.text, defaultVal?.text ?? '')
        }
      }
    }

    if (paramProps.size === 0) return null

    // Check body for assignments to this.name = default
    const body = node.childForFieldName('body')
    if (!body) return null

    for (const stmt of body.namedChildren) {
      if (stmt.type !== 'expression_statement') continue
      const expr = stmt.namedChildren[0]
      if (!expr || expr.type !== 'assignment_expression') continue

      const lhs = expr.namedChildren[0]
      const rhs = expr.namedChildren[1]
      if (!lhs || !rhs) continue

      // Check for this.propName = value
      if (lhs.type === 'member_expression') {
        const obj = lhs.childForFieldName('object')
        const prop = lhs.childForFieldName('property')
        if (obj?.text === 'this' && prop) {
          const propName = prop.text
          if (paramProps.has(propName)) {
            const defaultVal = paramProps.get(propName) ?? ''
            if (defaultVal && rhs.text === defaultVal) {
              return makeViolation(
                this.ruleKey, stmt, filePath, 'low',
                'Unnecessary parameter property assignment',
                `\`this.${propName} = ${rhs.text}\` is redundant — the constructor parameter already has this default value.`,
                sourceCode,
                `Remove the \`this.${propName} = ${rhs.text}\` assignment from the constructor body.`,
              )
            }
          }
        }
      }
    }

    return null
  },
}
