import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInvalidEnvvarValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-envvar-value',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'os' || (attr?.text !== 'getenv' && attr?.text !== 'environ')) return null
    // Focus on os.getenv
    if (attr?.text !== 'getenv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren.find((c) => c.type !== 'comment')
    if (!firstArg) return null

    // If the first arg is a keyword argument named "key" with a non-string value
    const NON_STRING_TYPES = new Set(['integer', 'float', 'true', 'false', 'none', 'list', 'dictionary', 'set', 'tuple'])
    if (NON_STRING_TYPES.has(firstArg.type)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Invalid os.getenv argument type',
        `\`os.getenv(${firstArg.text})\` receives a non-string argument — the first argument must be a string variable name. This raises TypeError at runtime.`,
        sourceCode,
        'Pass a string as the first argument: `os.getenv("MY_VAR")`.',
      )
    }
    return null
  },
}
