import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Scikit-Learn BaseEstimator __init__ methods that set attributes
 * ending with underscore (_), which are reserved for fitted state.
 */
export const pythonSklearnEstimatorTrailingUnderscoreVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sklearn-estimator-trailing-underscore',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class inherits from BaseEstimator
    const bases = node.childForFieldName('superclasses')
    if (!bases) return null

    const inheritsBaseEstimator = bases.namedChildren.some((base) => {
      const text = base.text
      return text === 'BaseEstimator' || text.endsWith('.BaseEstimator')
    })

    if (!inheritsBaseEstimator) return null

    // Find __init__ method
    const body = node.childForFieldName('body')
    if (!body) return null

    for (const member of body.namedChildren) {
      const funcNode =
        member.type === 'function_definition' ? member :
        member.type === 'decorated_definition' ? member.namedChildren.find((c) => c.type === 'function_definition') ?? null :
        null

      if (!funcNode) continue

      const funcName = funcNode.childForFieldName('name')
      if (funcName?.text !== '__init__') continue

      // Find assignments to self.xxx_ (trailing underscore)
      const funcBody = funcNode.childForFieldName('body')
      if (!funcBody) continue

      function findTrailingUnderscoreAssignment(n: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
        if (n.type === 'assignment') {
          const left = n.childForFieldName('left')
          if (
            left?.type === 'attribute' &&
            left.childForFieldName('object')?.text === 'self'
          ) {
            const attrName = left.childForFieldName('attribute')?.text ?? ''
            if (attrName.endsWith('_') && !attrName.endsWith('__')) {
              return left
            }
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) {
            const result = findTrailingUnderscoreAssignment(child)
            if (result) return result
          }
        }
        return null
      }

      const violation = findTrailingUnderscoreAssignment(funcBody)
      if (violation) {
        const attrName = violation.text
        const className = node.childForFieldName('name')?.text ?? 'Estimator'
        return makeViolation(
          this.ruleKey, violation, filePath, 'high',
          'BaseEstimator __init__ sets trailing underscore attribute',
          `\`${className}.__init__\` sets \`${attrName}\`, which has a trailing underscore — these are reserved for attributes set during \`fit()\` (fitted state). Setting them in \`__init__\` violates Scikit-Learn conventions.`,
          sourceCode,
          `Move \`${attrName}\` assignment to the \`fit()\` method. In \`__init__\`, only set hyperparameters without trailing underscores.`,
        )
      }
    }

    return null
  },
}
