import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects dataclass __post_init__ methods that have parameters with default values.
 * RUF033: The default will be overridden by the field's default, causing confusing behavior.
 */
export const pythonPostInitDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/post-init-default',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Must be named __post_init__
    const nameNode = node.childForFieldName('name')
    if (nameNode?.text !== '__post_init__') return null

    // Must be inside a class (check parent chain)
    let parent = node.parent
    while (parent && parent.type !== 'class_definition' && parent.type !== 'module') {
      parent = parent.parent
    }
    if (!parent || parent.type !== 'class_definition') return null

    // Check if the class has @dataclass decorator
    const classParent = node.parent
    let isDataclass = false
    if (classParent?.type === 'block') {
      const classDef = classParent.parent
      if (classDef?.type === 'class_definition') {
        // Look for @dataclass decorator on the class
        const classGrandparent = classDef.parent
        if (classGrandparent) {
          for (const sibling of classGrandparent.namedChildren) {
            if (sibling.type === 'decorated_definition') {
              const innerClass = sibling.namedChildren.find((c) => c.type === 'class_definition')
              if (innerClass === classDef) {
                const decorators = sibling.namedChildren.filter((c) => c.type === 'decorator')
                isDataclass = decorators.some((d) => {
                  const text = d.text
                  return text.includes('dataclass')
                })
              }
            }
          }
        }
      }
    }

    // Also check if class is decorated with dataclass in a simpler way:
    // Look for parent decorated_definition
    let grandparent = node.parent
    while (grandparent && grandparent.type !== 'decorated_definition' && grandparent.type !== 'module') {
      grandparent = grandparent.parent
    }

    if (!isDataclass && grandparent?.type === 'decorated_definition') {
      const decorators = grandparent.namedChildren.filter((c) => c.type === 'decorator')
      isDataclass = decorators.some((d) => d.text.includes('dataclass'))
    }

    if (!isDataclass) return null

    // Check for parameters with default values (besides self and InitVar parameters)
    const params = node.childForFieldName('parameters')
    if (!params) return null

    for (const param of params.namedChildren) {
      if (param.type === 'default_parameter' || param.type === 'typed_default_parameter') {
        const paramName = param.childForFieldName('name')
        const paramNameText = paramName?.text ?? 'param'
        // Skip self
        if (paramNameText === 'self') continue

        return makeViolation(
          this.ruleKey, param, filePath, 'medium',
          'Dataclass __post_init__ parameter with default value',
          `\`__post_init__\` has parameter \`${paramNameText}\` with a default value. In dataclasses, \`__post_init__\` parameters correspond to \`InitVar\` fields — the default set here may be unexpectedly overridden by the field's own default.`,
          sourceCode,
          `Remove the default from \`${paramNameText}\` in \`__post_init__\` and set defaults on the corresponding \`InitVar\` field instead.`,
        )
      }
    }

    return null
  },
}
