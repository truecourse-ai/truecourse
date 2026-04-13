import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

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

    // Check all arguments (positional and keyword) for a safe Loader
    let hasSafeLoader = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'Loader' && value) {
          if (containsPythonIdentifierExact(value, 'SafeLoader') ||
              containsPythonIdentifierExact(value, 'FullLoader')) {
            hasSafeLoader = true
            break
          }
        }
      } else {
        // Positional argument — the second positional is the Loader
        if (containsPythonIdentifierExact(arg, 'SafeLoader') ||
            containsPythonIdentifierExact(arg, 'FullLoader')) {
          hasSafeLoader = true
          break
        }
      }
    }

    if (!hasSafeLoader) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe YAML load',
        'yaml.load() without a SafeLoader can deserialize arbitrary Python objects and execute code.',
        sourceCode,
        'Use yaml.safe_load() or pass Loader=yaml.SafeLoader.',
      )
    }

    return null
  },
}
