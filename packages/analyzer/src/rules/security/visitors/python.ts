/**
 * Security domain Python visitors.
 */

import type { CodeRuleVisitor } from '../../types.js'
import { makeViolation } from '../../types.js'

const PYTHON_QUERY_METHODS = new Set([
  'execute', 'exec', 'raw', 'text',
  'executemany', 'executescript',
])

export const pythonSqlInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sql-injection',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!PYTHON_QUERY_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string' && firstArg.text.startsWith('f')) {
      const hasInterpolation = firstArg.namedChildren.some((c) => c.type === 'interpolation')
      if (hasInterpolation) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `f-string with interpolation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of f-strings in SQL.',
        )
      }
    }

    if (firstArg.type === 'binary_operator') {
      const op = firstArg.children.find((c) => c.text === '+')
      if (op) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Potential SQL injection',
          `String concatenation passed to ${methodName}(). Use parameterized queries instead.`,
          sourceCode,
          'Use parameterized queries (e.g., %s or :param) instead of string concatenation in SQL.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// eval-usage (Python: eval, exec, compile)
// ---------------------------------------------------------------------------

const PYTHON_EVAL_FUNCTIONS = new Set(['eval', 'exec', 'compile'])

export const pythonEvalUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/eval-usage',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (PYTHON_EVAL_FUNCTIONS.has(funcName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Dynamic code evaluation',
        `${funcName}() allows arbitrary code execution and is a security risk.`,
        sourceCode,
        `Avoid ${funcName}(). Use safer alternatives like ast.literal_eval() or JSON parsing.`,
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// os-command-injection (Python)
// ---------------------------------------------------------------------------

const PYTHON_SUBPROCESS_METHODS = new Set(['call', 'run', 'Popen', 'check_output', 'check_call'])
const PYTHON_OS_EXEC = new Set(['system', 'popen'])

export const pythonOsCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/os-command-injection',
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
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    // os.system(), os.popen()
    if (objectName === 'os' && PYTHON_OS_EXEC.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'OS command injection risk',
        `os.${methodName}() executes shell commands and is vulnerable to injection.`,
        sourceCode,
        'Use subprocess.run() with a list of arguments instead of os.system/popen.',
      )
    }

    // subprocess.call/run/Popen with shell=True
    if ((objectName === 'subprocess' && PYTHON_SUBPROCESS_METHODS.has(methodName)) ||
        PYTHON_SUBPROCESS_METHODS.has(methodName)) {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'shell' && value?.text === 'True') {
              return makeViolation(
                this.ruleKey, node, filePath, 'critical',
                'OS command injection risk',
                `${objectName ? objectName + '.' : ''}${methodName}() with shell=True is vulnerable to injection.`,
                sourceCode,
                'Remove shell=True and pass command as a list of arguments.',
              )
            }
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-hashing (Python)
// ---------------------------------------------------------------------------

const PYTHON_WEAK_HASH = new Set(['md5', 'sha1'])

export const pythonWeakHashingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-hashing',
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

    if (objectName === 'hashlib' && PYTHON_WEAK_HASH.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak hashing algorithm',
        `hashlib.${methodName}() uses a cryptographically weak algorithm.`,
        sourceCode,
        'Use hashlib.sha256() or stronger.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unverified-certificate (Python)
// ---------------------------------------------------------------------------

export const pythonUnverifiedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-certificate',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // ssl._create_unverified_context()
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr?.text === '_create_unverified_context' && obj?.text === 'ssl') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified TLS certificate',
          'ssl._create_unverified_context() disables TLS certificate verification.',
          sourceCode,
          'Use ssl.create_default_context() instead.',
        )
      }
    }

    // requests.get(..., verify=False)
    const args = node.childForFieldName('arguments')
    if (args) {
      for (const arg of args.namedChildren) {
        if (arg.type === 'keyword_argument') {
          const name = arg.childForFieldName('name')
          const value = arg.childForFieldName('value')
          if (name?.text === 'verify' && value?.text === 'False') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Unverified TLS certificate',
              'Setting verify=False disables TLS certificate verification.',
              sourceCode,
              'Remove verify=False or set verify=True.',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-cookie (Python)
// ---------------------------------------------------------------------------

export const pythonInsecureCookieVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-cookie',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'set_cookie') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for secure=True in keyword arguments
    let hasSecure = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'secure' && value?.text === 'True') {
          hasSecure = true
        }
      }
    }

    if (!hasSecure) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'Cookie set without the secure flag. It may be transmitted over unencrypted HTTP.',
        sourceCode,
        'Add secure=True to the set_cookie() call.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// cookie-without-httponly (Python)
// ---------------------------------------------------------------------------

export const pythonCookieWithoutHttpOnlyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/cookie-without-httponly',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'set_cookie') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    let hasHttpOnly = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'httponly' && value?.text === 'True') {
          hasHttpOnly = true
        }
      }
    }

    if (!hasHttpOnly) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cookie without httpOnly',
        'Cookie set without the httponly flag. It can be accessed by client-side JavaScript.',
        sourceCode,
        'Add httponly=True to the set_cookie() call.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// disabled-auto-escaping (Python)
// ---------------------------------------------------------------------------

export const pythonDisabledAutoEscapingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-auto-escaping',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    // Markup() — marks string as safe, bypassing auto-escaping
    if (funcName === 'Markup') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Disabled auto-escaping',
        'Markup() marks content as safe HTML, bypassing auto-escaping.',
        sourceCode,
        'Ensure the content is properly sanitized before using Markup().',
      )
    }

    // Jinja2 Environment/Template with autoescape=False
    if (funcName === 'Environment' || funcName === 'Template') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'autoescape' && value?.text === 'False') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Disabled auto-escaping',
                `${funcName}() with autoescape=False disables XSS protection.`,
                sourceCode,
                'Set autoescape=True or use select_autoescape().',
              )
            }
          }
        }
      }
    }

    return null
  },
}

export const SECURITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonSqlInjectionVisitor,
  pythonEvalUsageVisitor,
  pythonOsCommandInjectionVisitor,
  pythonWeakHashingVisitor,
  pythonUnverifiedCertificateVisitor,
  pythonInsecureCookieVisitor,
  pythonCookieWithoutHttpOnlyVisitor,
  pythonDisabledAutoEscapingVisitor,
]
