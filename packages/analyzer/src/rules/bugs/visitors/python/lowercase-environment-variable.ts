import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: os.environ["lowercase_key"] or os.environ.get("lowercase_key")
// Environment variables are conventionally UPPER_CASE
export const pythonLowercaseEnvironmentVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lowercase-environment-variable',
  languages: ['python'],
  nodeTypes: ['subscript', 'call'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'subscript') {
      // Pattern: os.environ["key"] or os.getenv is handled as call
      const obj = node.childForFieldName('value')
      if (!obj || !isOsEnviron(obj)) return null

      const key = node.childForFieldName('subscript')
      if (!key || key.type !== 'string') return null

      const keyValue = extractStringValue(key.text)
      if (!keyValue) return null

      if (isLowercase(keyValue)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Lowercase environment variable key',
          `Environment variable key \`"${keyValue}"\` is lowercase — environment variables are conventionally UPPER_CASE. This may indicate a typo or bug.`,
          sourceCode,
          `Change to \`os.environ["${keyValue.toUpperCase()}"]\` if this is an environment variable, or use a different mechanism for lowercase config.`,
        )
      }
    }

    if (node.type === 'call') {
      const func = node.childForFieldName('function')
      if (!func) return null

      // os.environ.get("key", ...) or os.getenv("key", ...)
      let isEnvGet = false
      if (func.type === 'attribute') {
        const obj = func.childForFieldName('object')
        const attr = func.childForFieldName('attribute')
        if (attr?.text === 'get' && obj && isOsEnviron(obj)) {
          isEnvGet = true
        }
        if (obj?.text === 'os' && attr?.text === 'getenv') {
          isEnvGet = true
        }
      }

      if (!isEnvGet) return null

      const args = node.childForFieldName('arguments')
      if (!args) return null

      const firstArg = args.namedChildren[0]
      if (!firstArg || firstArg.type !== 'string') return null

      const keyValue = extractStringValue(firstArg.text)
      if (!keyValue) return null

      if (isLowercase(keyValue)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Lowercase environment variable key',
          `Environment variable key \`"${keyValue}"\` is lowercase — environment variables are conventionally UPPER_CASE. This may indicate a typo or bug.`,
          sourceCode,
          `Change to \`"${keyValue.toUpperCase()}"\` if this is an environment variable.`,
        )
      }
    }

    return null
  },
}

function isOsEnviron(node: import('tree-sitter').SyntaxNode): boolean {
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    return obj?.text === 'os' && attr?.text === 'environ'
  }
  return false
}

function extractStringValue(raw: string): string | null {
  if ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return null
}

function isLowercase(s: string): boolean {
  // Has lowercase letters and no uppercase letters
  return /[a-z]/.test(s) && !/[A-Z]/.test(s)
}
