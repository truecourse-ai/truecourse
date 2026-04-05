/**
 * Security domain JS/TS visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

const QUERY_METHOD_NAMES = new Set([
  'query', 'execute', 'exec', 'raw', 'rawQuery',
  'sequelize', '$queryRaw', '$executeRaw',
])

export const sqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sql-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!QUERY_METHOD_NAMES.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'template_string') {
      const hasSubstitution = firstArg.namedChildren.some((c) => c.type === 'template_substitution')
      if (hasSubstitution) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `Template literal with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., $1, ?) instead of string interpolation in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_expression') {
      const operator = firstArg.children.find((c) => c.type === '+')
      if (operator) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., $1, ?) instead of string concatenation in SQL.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// eval-usage
// ---------------------------------------------------------------------------

const EVAL_FUNCTIONS = new Set(['eval', 'exec'])
const TIMER_FUNCTIONS = new Set(['setTimeout', 'setInterval'])

export const evalUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/eval-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function') ?? node.childForFieldName('constructor')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // eval(), exec()
    if (EVAL_FUNCTIONS.has(funcName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        `${funcName}() allows arbitrary code execution and is a security risk.`,
        sourceCode,
        'Avoid eval/exec. Use safer alternatives like JSON.parse() or a sandboxed interpreter.',
      )
    }

    // new Function(...)
    if (node.type === 'new_expression' && funcName === 'Function') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        'new Function() is equivalent to eval() and allows arbitrary code execution.',
        sourceCode,
        'Avoid the Function constructor. Use safer alternatives.',
      )
    }

    // setTimeout/setInterval with string argument
    if (TIMER_FUNCTIONS.has(funcName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        const firstArg = args.namedChildren[0]
        if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Dynamic code evaluation',
            `${funcName}() with a string argument is equivalent to eval().`,
            sourceCode,
            'Pass a function reference instead of a string to setTimeout/setInterval.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// os-command-injection
// ---------------------------------------------------------------------------

const EXEC_METHODS = new Set(['exec', 'execSync'])
const SPAWN_METHODS = new Set(['spawn', 'spawnSync'])

export const osCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/os-command-injection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    // child_process.exec() / execSync()
    if (EXEC_METHODS.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'OS command injection risk',
        `${methodName}() executes shell commands and is vulnerable to command injection.`,
        sourceCode,
        'Use execFile() or spawn() without shell:true to avoid shell interpretation.',
      )
    }

    // spawn with shell: true
    if (SPAWN_METHODS.has(methodName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object') {
            for (const prop of arg.namedChildren) {
              if (prop.type === 'pair') {
                const key = prop.childForFieldName('key')
                const value = prop.childForFieldName('value')
                if (key?.text === 'shell' && value?.text === 'true') {
                  return makeViolation(
                    this.ruleKey, node, filePath, 'critical',
                    'OS command injection risk',
                    `${methodName}() with shell:true is vulnerable to command injection.`,
                    sourceCode,
                    'Remove shell:true or use execFile() for safer command execution.',
                  )
                }
              }
            }
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-hashing
// ---------------------------------------------------------------------------

const WEAK_ALGORITHMS = new Set(['md5', 'sha1'])

export const weakHashingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-hashing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'createHash') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (WEAK_ALGORITHMS.has(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak hashing algorithm',
        `crypto.createHash('${argText}') uses a cryptographically weak algorithm.`,
        sourceCode,
        'Use SHA-256 or stronger (e.g., crypto.createHash("sha256")).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unverified-certificate
// ---------------------------------------------------------------------------

export const unverifiedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-certificate',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'pair') {
      const key = node.childForFieldName('key')
      const value = node.childForFieldName('value')
      if (key?.text === 'rejectUnauthorized' && value?.text === 'false') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified TLS certificate',
          'Setting rejectUnauthorized to false disables TLS certificate verification.',
          sourceCode,
          'Remove rejectUnauthorized: false or set it to true for production.',
        )
      }
    }

    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left && right) {
        const leftText = left.text
        if (leftText.includes('NODE_TLS_REJECT_UNAUTHORIZED') && right.text === '"0"') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unverified TLS certificate',
            'Setting NODE_TLS_REJECT_UNAUTHORIZED to "0" disables TLS verification globally.',
            sourceCode,
            'Remove this setting. Fix the certificate issue instead of disabling verification.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// permissive-cors
// ---------------------------------------------------------------------------

export const permissiveCorsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/permissive-cors',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // cors({ origin: '*' })
    if (funcName === 'cors') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'object') {
            for (const prop of arg.namedChildren) {
              if (prop.type === 'pair') {
                const key = prop.childForFieldName('key')
                const value = prop.childForFieldName('value')
                if (key?.text === 'origin' && (value?.text === "'*'" || value?.text === '"*"')) {
                  return makeViolation(
                    this.ruleKey, node, filePath, 'high',
                    'Permissive CORS configuration',
                    'CORS with origin: \'*\' allows any domain to make requests.',
                    sourceCode,
                    'Restrict CORS origin to specific trusted domains.',
                  )
                }
              }
            }
          }
        }
      }
    }

    // res.header('Access-Control-Allow-Origin', '*')
    if (funcName === 'header' || funcName === 'setHeader' || funcName === 'set') {
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildren.length >= 2) {
        const headerName = args.namedChildren[0]?.text.replace(/['"]/g, '').toLowerCase()
        const headerValue = args.namedChildren[1]?.text.replace(/['"]/g, '')
        if (headerName === 'access-control-allow-origin' && headerValue === '*') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Permissive CORS configuration',
            'Setting Access-Control-Allow-Origin to \'*\' allows any domain.',
            sourceCode,
            'Restrict the origin to specific trusted domains.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-cookie & cookie-without-httponly (shared helper)
// ---------------------------------------------------------------------------

function findCookieOptionsObject(node: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
  const fn = node.childForFieldName('function')
  if (!fn) return null

  let methodName = ''
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop) methodName = prop.text
  }

  if (methodName !== 'cookie') return null

  const args = node.childForFieldName('arguments')
  if (!args || args.namedChildren.length < 3) return null

  const optionsArg = args.namedChildren[2]
  if (optionsArg?.type === 'object') return optionsArg

  return null
}

function objectHasProperty(objectNode: import('tree-sitter').SyntaxNode, propName: string, propValue: string): boolean {
  for (const child of objectNode.namedChildren) {
    if (child.type === 'pair') {
      const key = child.childForFieldName('key')
      const value = child.childForFieldName('value')
      if (key?.text === propName && value?.text === propValue) return true
    }
  }
  return false
}

export const insecureCookieVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-cookie',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const optionsObj = findCookieOptionsObject(node)
    if (!optionsObj) return null

    if (!objectHasProperty(optionsObj, 'secure', 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'Cookie set without the secure flag. It may be transmitted over unencrypted HTTP.',
        sourceCode,
        'Add secure: true to the cookie options.',
      )
    }

    return null
  },
}

export const cookieWithoutHttpOnlyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/cookie-without-httponly',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const optionsObj = findCookieOptionsObject(node)
    if (!optionsObj) return null

    if (!objectHasProperty(optionsObj, 'httpOnly', 'true')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cookie without httpOnly',
        'Cookie set without the httpOnly flag. It can be accessed by client-side JavaScript.',
        sourceCode,
        'Add httpOnly: true to the cookie options.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// disabled-auto-escaping
// ---------------------------------------------------------------------------

export const disabledAutoEscapingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-auto-escaping',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // dangerouslySetInnerHTML
    if (node.type === 'jsx_attribute') {
      const name = node.namedChildren[0]
      if (name && name.text === 'dangerouslySetInnerHTML') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Disabled auto-escaping',
          'dangerouslySetInnerHTML bypasses React\'s XSS protections.',
          sourceCode,
          'Avoid dangerouslySetInnerHTML. Use safe rendering methods or sanitize input with DOMPurify.',
        )
      }
    }

    // element.innerHTML = ...
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      if (left?.type === 'member_expression') {
        const prop = left.childForFieldName('property')
        if (prop?.text === 'innerHTML') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Disabled auto-escaping',
            'Direct innerHTML assignment can lead to XSS vulnerabilities.',
            sourceCode,
            'Use textContent instead of innerHTML, or sanitize input with DOMPurify.',
          )
        }
      }
    }

    return null
  },
}

export const SECURITY_JS_VISITORS: CodeRuleVisitor[] = [
  sqlInjectionVisitor,
  evalUsageVisitor,
  osCommandInjectionVisitor,
  weakHashingVisitor,
  unverifiedCertificateVisitor,
  permissiveCorsVisitor,
  insecureCookieVisitor,
  cookieWithoutHttpOnlyVisitor,
  disabledAutoEscapingVisitor,
]
