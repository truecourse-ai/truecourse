import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects ML reduction operations (sum, mean, max, min, etc.) called without
 * specifying axis/dim — may reduce entire tensor unexpectedly.
 * S6929.
 */

// Methods on numpy/torch/tensorflow arrays that perform reductions
const REDUCTION_METHODS = new Set(['sum', 'mean', 'max', 'min', 'std', 'var', 'prod', 'all', 'any', 'norm'])

// Axis/dim parameter names
const AXIS_PARAMS = new Set(['axis', 'dim', 'keepdims', 'keepdim'])

// Common ML object names that suggest tensor/array context
const ML_OBJECT_PATTERNS = [
  /^x$/, /^y$/, /^tensor/, /^arr/, /^array/, /^feat/, /^embed/, /^logit/,
  /^output/, /^input/, /^hidden/, /^weight/, /^bias/, /^grad/, /^pred/,
  /\.data$/, /self\./,
]

function looksLikeTensor(name: string): boolean {
  return ML_OBJECT_PATTERNS.some((p) => p.test(name))
}

export const pythonMlReductionAxisMissingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ml-reduction-axis-missing',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Method call: obj.sum(), obj.mean(), etc.
    if (func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    const obj = func.childForFieldName('object')
    if (!attr || !obj) return null

    const methodName = attr.text
    if (!REDUCTION_METHODS.has(methodName)) return null

    // Check if the object looks like a tensor/array
    const objText = obj.text
    if (!looksLikeTensor(objText)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if axis/dim is specified (positional or keyword)
    const hasAxisArg = args.namedChildren.some((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key && AXIS_PARAMS.has(key.text)
      }
      // Positional args: sum() with one positional arg is the axis
      // Only flag if there are NO positional args (the call has zero args)
      return false
    })

    const hasPositionalArgs = args.namedChildren.some((arg) =>
      arg.type !== 'keyword_argument',
    )

    if (!hasAxisArg && !hasPositionalArgs) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Reduction operation without axis/dim',
        `\`${objText}.${methodName}()\` called without specifying \`axis\` or \`dim\` — this reduces the entire tensor to a scalar, which may be unintentional.`,
        sourceCode,
        `Specify the reduction axis: \`${objText}.${methodName}(axis=1)\` or \`${objText}.${methodName}(dim=1)\`.`,
      )
    }

    return null
  },
}
