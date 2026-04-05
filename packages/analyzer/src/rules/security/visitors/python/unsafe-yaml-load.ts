import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnsafeYamlLoadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-yaml-load',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    if (methodName !== 'load') return null
    if (objectName !== 'yaml') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // If the second argument is not SafeLoader or FullLoader, flag it
    if (args.namedChildren.length < 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe YAML load',
        'yaml.load() without a SafeLoader can deserialize arbitrary Python objects and execute code.',
        sourceCode,
        'Use yaml.safe_load() or pass Loader=yaml.SafeLoader.',
      )
    }

    const loaderArg = args.namedChildren[1]
    const loaderText = loaderArg?.text ?? ''
    if (!loaderText.includes('SafeLoader') && !loaderText.includes('FullLoader') &&
        !loaderText.includes('safe_load')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe YAML load',
        `yaml.load() with Loader=${loaderText} may allow arbitrary code execution.`,
        sourceCode,
        'Use yaml.safe_load() or pass Loader=yaml.SafeLoader.',
      )
    }

    return null
  },
}
