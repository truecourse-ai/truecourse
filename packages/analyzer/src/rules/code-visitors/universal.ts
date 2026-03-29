/**
 * Language-agnostic code rule visitors — work on all languages.
 */

import type { CodeRuleVisitor } from './common.js'
import { makeViolation } from './common.js'

const SECRET_PATTERNS = [
  /^(?:sk|pk)[-_](?:live|test)[-_]/i,
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /^(?:eyJ)[A-Za-z0-9_-]{20,}\.eyJ/,
  /^AKIA[0-9A-Z]{16}/,
  /^xox[bporsac]-[0-9]{10,}/,
  /(?:password|passwd|secret|api_?key|apikey|token|auth)[\s]*[:=][\s]*['"][^'"]{8,}['"]/i,
]

export const hardcodedSecretVisitor: CodeRuleVisitor = {
  ruleKey: 'code/hardcoded-secret',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Strip string prefix (f, b, r, u for Python) and quotes
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (stripped.length < 8) return null
    const value = stripped

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Hardcoded secret detected',
          'This string looks like a hardcoded API key, token, or password. Use environment variables instead.',
          sourceCode,
          'Move this secret to an environment variable and reference it via process.env.',
        )
      }
    }

    const parent = node.parent
    if (parent) {
      // Skip if this string node is the key of a dict/object pair — only check values
      if (parent.type === 'pair' && parent.childForFieldName('key') === node) {
        return null
      }

      const varDeclarator = parent.type === 'variable_declarator' ? parent : null
      const assignment = parent.type === 'assignment_expression' || parent.type === 'assignment' ? parent : null
      const propAssignment = parent.type === 'pair' ? parent : null

      let nameNode = varDeclarator?.childForFieldName('name')
        || assignment?.childForFieldName('left')
        || propAssignment?.childForFieldName('key')

      if (nameNode) {
        const name = nameNode.text.toLowerCase()
        const secretNames = ['password', 'passwd', 'secret', 'apikey', 'api_key', 'token', 'auth_token', 'access_token', 'private_key']
        // Exclude variable names that are clearly not secrets (URIs, URLs, endpoints, types)
        const isNonSecretName = /(?:uri|url|endpoint|type|scope|name|header|grant|method)/.test(name)
        const isNonSecretValue =
          /https?:\/\//.test(value)                          // URLs
          || /^(true|false|null|undefined|localhost|None|True|False|Bearer)$/i.test(value) // literals & common tokens
          || /[[\]<>{}()#.=\s]/.test(value)                  // selectors, HTML, format strings, paths
        if (secretNames.some((s) => name.includes(s)) && value.length >= 8 && !isNonSecretName && !isNonSecretValue) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'Hardcoded secret detected',
            `Variable "${nameNode.text}" contains what appears to be a hardcoded secret. Use environment variables instead.`,
            sourceCode,
            'Move this secret to an environment variable.',
          )
        }
      }
    }

    return null
  },
}

export const todoFixmeVisitor: CodeRuleVisitor = {
  ruleKey: 'code/todo-fixme',
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const match = text.match(/\b(TODO|FIXME|HACK)\b/i)
    if (!match) return null

    const tag = match[1].toUpperCase()
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${tag} comment`,
      `${tag} comment found: ${text.trim().slice(0, 100)}`,
      sourceCode,
    )
  },
}

export const UNIVERSAL_VISITORS: CodeRuleVisitor[] = [
  hardcodedSecretVisitor,
  todoFixmeVisitor,
]
