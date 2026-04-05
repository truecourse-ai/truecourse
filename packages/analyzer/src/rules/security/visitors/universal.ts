/**
 * Security domain language-agnostic visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

const SECRET_PATTERNS = [
  /^(?:sk|pk)[-_](?:live|test)[-_]/i,
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /^(?:eyJ)[A-Za-z0-9_-]{20,}\.eyJ/,
  /^AKIA[0-9A-Z]{16}/,
  /^xox[bporsac]-[0-9]{10,}/,
  /(?:password|passwd|secret|api_?key|apikey|token|auth)[\s]*[:=][\s]*['"][^'"]{8,}['"]/i,
]

export const hardcodedSecretVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-secret',
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

// ---------------------------------------------------------------------------
// hardcoded-ip
// ---------------------------------------------------------------------------

const IPV4_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/
const EXCLUDED_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255'])

export const hardcodedIpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-ip',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    const match = IPV4_REGEX.exec(stripped)
    if (!match) return null

    const ip = match[1]
    if (EXCLUDED_IPS.has(ip)) return null

    // Validate each octet is 0-255
    const octets = ip.split('.')
    if (octets.some((o) => parseInt(o, 10) > 255)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded IP address',
      `Hardcoded IP address "${ip}" found. Use configuration or DNS names instead.`,
      sourceCode,
      'Move IP addresses to configuration files or environment variables.',
    )
  },
}

// ---------------------------------------------------------------------------
// clear-text-protocol
// ---------------------------------------------------------------------------

const CLEARTEXT_PROTOCOLS = ['http://', 'ftp://', 'telnet://']
const LOCALHOST_PREFIXES = ['http://localhost', 'http://127.0.0.1', 'http://0.0.0.0']

export const clearTextProtocolVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/clear-text-protocol',
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^[fFbBrRuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    const lower = stripped.toLowerCase()

    for (const protocol of CLEARTEXT_PROTOCOLS) {
      if (lower.startsWith(protocol)) {
        // Exclude localhost/loopback for local development
        if (LOCALHOST_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
          return null
        }
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Clear-text protocol',
          `Use of unencrypted protocol "${protocol}" detected. Data may be intercepted in transit.`,
          sourceCode,
          'Use encrypted protocols (https://, sftp://, ssh://) instead.',
        )
      }
    }

    return null
  },
}

export const SECURITY_UNIVERSAL_VISITORS: CodeRuleVisitor[] = [
  hardcodedSecretVisitor,
  hardcodedIpVisitor,
  clearTextProtocolVisitor,
]
