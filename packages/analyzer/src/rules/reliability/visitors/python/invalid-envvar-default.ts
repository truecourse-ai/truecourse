import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInvalidEnvVarDefaultVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/invalid-envvar-default',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'os' || attr?.text !== 'getenv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const namedArgs = args.namedChildren
    if (namedArgs.length < 2) return null

    const defaultArg = namedArgs[1]
    if (!defaultArg) return null

    // Check if default is a non-string type (integer, float, boolean, None, list, dict)
    if (
      defaultArg.type === 'integer' ||
      defaultArg.type === 'float' ||
      defaultArg.type === 'true' ||
      defaultArg.type === 'false' ||
      defaultArg.type === 'list' ||
      defaultArg.type === 'dictionary'
    ) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'os.getenv() with non-string default',
        `os.getenv() returns a string or the default. Default value ${defaultArg.text} is not a string, which may cause type mismatches.`,
        sourceCode,
        'Use a string default and convert: int(os.getenv("KEY", "0")).',
      )
    }

    return null
  },
}
