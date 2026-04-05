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

// ---------------------------------------------------------------------------
// weak-cipher (Python)
// ---------------------------------------------------------------------------

const PYTHON_WEAK_CIPHER_CLASSES = new Set(['DES', 'DES3', 'ARC4', 'Blowfish', 'XOR'])

export const pythonWeakCipherVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-cipher',
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

    // DES.new(), ARC4.new(), Blowfish.new()
    if (methodName === 'new' && PYTHON_WEAK_CIPHER_CLASSES.has(objectName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak cipher algorithm',
        `${objectName}.new() uses a weak cipher. ${objectName} is cryptographically broken.`,
        sourceCode,
        'Use AES from Crypto.Cipher instead.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-crypto-key (Python)
// ---------------------------------------------------------------------------

export const pythonWeakCryptoKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-crypto-key',
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

    if (methodName !== 'generate_private_key') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for key_size keyword argument
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'key_size' && value) {
          const num = parseInt(value.text, 10)
          if (!isNaN(num) && num < 2048) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Weak cryptographic key size',
              `RSA key size ${num} bits is too small. Minimum recommended is 2048 bits.`,
              sourceCode,
              'Use at least 2048-bit RSA keys: rsa.generate_private_key(key_size=2048, ...).',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-ssl (Python)
// ---------------------------------------------------------------------------

const PYTHON_WEAK_SSL_ATTRS = new Set([
  'PROTOCOL_SSLv2', 'PROTOCOL_SSLv3', 'PROTOCOL_SSLv23',
  'PROTOCOL_TLSv1', 'PROTOCOL_TLS',
])

export const pythonWeakSslVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-ssl',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    const obj = node.childForFieldName('object')

    if (obj?.text === 'ssl' && attr && PYTHON_WEAK_SSL_ATTRS.has(attr.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak SSL/TLS protocol',
        `ssl.${attr.text} uses a deprecated protocol. SSLv2, SSLv3, and TLS 1.0 are insecure.`,
        sourceCode,
        'Use ssl.PROTOCOL_TLS_CLIENT or ssl.create_default_context() for modern TLS.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-jwt (Python)
// ---------------------------------------------------------------------------

export const pythonInsecureJwtVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-jwt',
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

    if (methodName !== 'encode' && methodName !== 'decode') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'algorithm' || name?.text === 'algorithms') {
          const algText = value?.text.replace(/['"]/g, '').toLowerCase() ?? ''
          if (algText === 'none' || algText === 'hs256') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Insecure JWT configuration',
              `JWT ${methodName}() with algorithm "${value?.text.replace(/['"]/g, '')}" is insecure.`,
              sourceCode,
              'Use RS256, ES256, or another strong asymmetric algorithm.',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// encryption-insecure-mode (Python)
// ---------------------------------------------------------------------------

export const pythonEncryptionInsecureModeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/encryption-insecure-mode',
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

    if (methodName !== 'new') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // AES.new(key, AES.MODE_ECB) — second positional arg or mode= keyword
    for (const arg of args.namedChildren) {
      if (arg.type === 'attribute') {
        const attrName = arg.childForFieldName('attribute')
        if (attrName?.text === 'MODE_ECB') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure encryption mode',
            'ECB mode does not provide semantic security. Identical plaintext blocks produce identical ciphertext.',
            sourceCode,
            'Use MODE_GCM or MODE_CBC instead of MODE_ECB.',
          )
        }
      }
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'mode' && value?.text.includes('MODE_ECB')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure encryption mode',
            'ECB mode does not provide semantic security. Identical plaintext blocks produce identical ciphertext.',
            sourceCode,
            'Use MODE_GCM or MODE_CBC instead of MODE_ECB.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unverified-hostname (Python)
// ---------------------------------------------------------------------------

export const pythonUnverifiedHostnameVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-hostname',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (left?.type === 'attribute') {
      const attr = left.childForFieldName('attribute')
      if (attr?.text === 'check_hostname' && right?.text === 'False') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified hostname',
          'Setting check_hostname to False disables TLS hostname verification.',
          sourceCode,
          'Set check_hostname = True to verify server hostnames.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// xml-xxe (Python)
// ---------------------------------------------------------------------------

const PYTHON_UNSAFE_XML_PARSERS = new Set(['parse', 'fromstring', 'iterparse', 'XMLParser'])

export const pythonXmlXxeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xml-xxe',
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

    // xml.etree.ElementTree.parse(), ET.parse(), etree.parse()
    if (PYTHON_UNSAFE_XML_PARSERS.has(methodName) &&
        (objectName.includes('ElementTree') || objectName === 'ET' || objectName === 'etree' ||
         objectName === 'xml' || objectName === 'lxml')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'XML external entity injection',
        `${objectName}.${methodName}() may be vulnerable to XXE attacks.`,
        sourceCode,
        'Use defusedxml instead: from defusedxml.ElementTree import parse.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-unzip (Python)
// ---------------------------------------------------------------------------

const PYTHON_EXTRACT_METHODS = new Set(['extractall', 'extract'])

export const pythonUnsafeUnzipVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-unzip',
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

    if (PYTHON_EXTRACT_METHODS.has(methodName)) {
      // Check context — is this likely a ZipFile/TarFile method?
      const fullText = fn.text
      if (fullText.includes('zip') || fullText.includes('Zip') ||
          fullText.includes('tar') || fullText.includes('Tar') ||
          fullText.includes('archive') || fullText.includes('Archive')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe archive extraction',
          `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
          sourceCode,
          'Validate archive entry sizes and count before extraction. Use extractall() with caution.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// file-permissions-world-accessible (Python)
// ---------------------------------------------------------------------------

const PYTHON_WORLD_PERMS = new Set(['0o777', '0o776', '0o766', '0o667', '0o666'])

export const pythonFilePermissionsWorldAccessibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/file-permissions-world-accessible',
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

    if (methodName !== 'chmod') return null
    if (objectName !== 'os') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      const t = arg.text.toLowerCase()
      if (PYTHON_WORLD_PERMS.has(t) || t === '511' || t === '438') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'World-accessible file permissions',
          `os.chmod() sets overly permissive file permissions (${arg.text}).`,
          sourceCode,
          'Use restrictive permissions like 0o600 or 0o644.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// confidential-info-logging (Python)
// ---------------------------------------------------------------------------

const PYTHON_LOG_METHODS = new Set(['info', 'warning', 'error', 'debug', 'critical', 'log'])
const PYTHON_SENSITIVE_PATTERN = /(?:password|passwd|secret|token|api_key|private_key|credential|mnemonic)/i

export const pythonConfidentialInfoLoggingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/confidential-info-logging',
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

    const isPrint = methodName === 'print'
    const isLogging = PYTHON_LOG_METHODS.has(methodName) && (objectName === 'logging' || objectName === 'logger' || objectName === 'log')

    if (!isPrint && !isLogging) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'identifier' && PYTHON_SENSITIVE_PATTERN.test(arg.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Confidential info logging',
          `Logging sensitive variable "${arg.text}". This may expose secrets in logs.`,
          sourceCode,
          'Remove sensitive data from log statements or redact it.',
        )
      }
      if (arg.type === 'attribute') {
        const attrChild = arg.childForFieldName('attribute')
        if (attrChild && PYTHON_SENSITIVE_PATTERN.test(attrChild.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Confidential info logging',
            `Logging sensitive attribute "${attrChild.text}". This may expose secrets in logs.`,
            sourceCode,
            'Remove sensitive data from log statements or redact it.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// production-debug-enabled (Python)
// ---------------------------------------------------------------------------

export const pythonProductionDebugEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/production-debug-enabled',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    // DEBUG = True or app.debug = True
    const leftText = left.text.toLowerCase()
    if ((leftText === 'debug' || leftText.endsWith('.debug')) && right.text === 'True') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Production debug enabled',
        'Debug mode is enabled. This may leak sensitive information in production.',
        sourceCode,
        'Set DEBUG = False in production configurations.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-random (Python)
// ---------------------------------------------------------------------------

export const pythonInsecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
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

    if (objectName !== 'random') return null
    if (methodName !== 'random' && methodName !== 'randint' && methodName !== 'choice') return null

    // Check if used in security-sensitive context
    let parent = node.parent
    while (parent) {
      const parentText = parent.text.toLowerCase()
      if (parentText.includes('token') || parentText.includes('secret') ||
          parentText.includes('key') || parentText.includes('nonce') ||
          parentText.includes('salt') || parentText.includes('password') ||
          parentText.includes('session')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Insecure random number generator',
          `random.${methodName}() is not cryptographically secure. Do not use it for tokens, keys, or secrets.`,
          sourceCode,
          'Use secrets.token_hex() or secrets.token_urlsafe() instead.',
        )
      }
      if (parent.type === 'expression_statement' || parent.type === 'assignment') break
      parent = parent.parent
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// subprocess-security (Python)
// ---------------------------------------------------------------------------

export const pythonSubprocessSecurityVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/subprocess-security',
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

    if (objectName !== 'subprocess' || methodName !== 'Popen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check if first arg is a list with a non-absolute-path first element
    if (firstArg.type === 'list') {
      const firstElem = firstArg.namedChildren[0]
      if (firstElem && firstElem.type === 'string') {
        const cmd = firstElem.text.replace(/['"]/g, '')
        if (!cmd.startsWith('/') && !cmd.startsWith('C:\\')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Subprocess without full path',
            `subprocess.Popen() uses relative command "${cmd}". A malicious PATH could substitute a different binary.`,
            sourceCode,
            'Use the full path to the executable (e.g., "/usr/bin/ls").',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// partial-path-execution (Python)
// ---------------------------------------------------------------------------

const PYTHON_OS_EXEC_METHODS = new Set(['execl', 'execle', 'execlp', 'execlpe', 'execv', 'execve', 'execvp', 'execvpe'])

export const pythonPartialPathExecutionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/partial-path-execution',
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

    if (objectName !== 'os' || !PYTHON_OS_EXEC_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    if (firstArg.type === 'string') {
      const cmd = firstArg.text.replace(/['"]/g, '')
      if (!cmd.startsWith('/') && !cmd.startsWith('C:\\')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Partial path execution',
          `os.${methodName}() uses relative path "${cmd}". A malicious PATH could substitute a different binary.`,
          sourceCode,
          'Use the full path to the executable (e.g., "/usr/bin/ls").',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ssl-version-unsafe (Python)
// ---------------------------------------------------------------------------

export const pythonSslVersionUnsafeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssl-version-unsafe',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    // ctx.minimum_version = ssl.TLSVersion.TLSv1 or TLSv1_1
    if (left.type === 'attribute') {
      const attr = left.childForFieldName('attribute')
      if (attr?.text === 'minimum_version') {
        const val = right.text
        if (val.includes('TLSv1_1') || (val.includes('TLSv1') && !val.includes('TLSv1_2') && !val.includes('TLSv1_3'))) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unsafe SSL/TLS minimum version',
            `Setting minimum TLS version to ${val}. TLS 1.0 and 1.1 are deprecated.`,
            sourceCode,
            'Set minimum_version to ssl.TLSVersion.TLSv1_2 or higher.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// vulnerable-library-import (Python)
// ---------------------------------------------------------------------------

const VULNERABLE_MODULES = new Set(['httpoxy', 'pyghmi', 'pycrypto', 'telnetlib'])

export const pythonVulnerableLibraryImportVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/vulnerable-library-import',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // import httpoxy / from httpoxy import ...
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name' || child.type === 'aliased_import') {
        const name = child.type === 'aliased_import' ? child.namedChildren[0]?.text : child.text
        if (name && VULNERABLE_MODULES.has(name)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Vulnerable library import',
            `Importing "${name}" which has known security vulnerabilities.`,
            sourceCode,
            `Replace "${name}" with a maintained, secure alternative.`,
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// process-start-no-shell (Python)
// ---------------------------------------------------------------------------

export const pythonProcessStartNoShellVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/process-start-no-shell',
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

    if (objectName !== 'subprocess' || methodName !== 'Popen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag if first arg is a string (not a list) — indicating shell command as string
    if (firstArg.type === 'string' || firstArg.type === 'concatenated_string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Subprocess with string command',
        'subprocess.Popen() with a string argument may invoke the shell implicitly. Use a list of arguments instead.',
        sourceCode,
        'Pass command as a list: subprocess.Popen(["cmd", "arg1", "arg2"]).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// non-octal-file-permissions (Python)
// ---------------------------------------------------------------------------

export const pythonNonOctalFilePermissionsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/non-octal-file-permissions',
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

    if (methodName !== 'chmod') return null
    if (objectName !== 'os') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Second arg is the mode
    const modeArg = args.namedChildren[1]
    if (!modeArg) return null

    if (modeArg.type === 'integer') {
      const text = modeArg.text
      // If it's a decimal number (not starting with 0o, 0x, 0b) and common permission values
      if (!text.startsWith('0o') && !text.startsWith('0O') && !text.startsWith('0x') && !text.startsWith('0b')) {
        const num = parseInt(text, 10)
        // Common mistaken decimal permissions: 777, 755, 644, 666, etc.
        if (num >= 100 && num <= 777) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Non-octal file permissions',
            `os.chmod() called with decimal ${text} instead of octal 0o${text}. Decimal ${text} is octal ${num.toString(8)}, which is likely not the intended permission.`,
            sourceCode,
            `Use octal notation: os.chmod(path, 0o${text}).`,
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-yaml-load (Python)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// unsafe-pickle-usage (Python)
// ---------------------------------------------------------------------------

export const pythonUnsafePickleUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-pickle-usage',
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

    if (methodName !== 'loads' && methodName !== 'load') return null
    if (objectName !== 'pickle' && objectName !== 'cPickle' && objectName !== '_pickle') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'Unsafe pickle usage',
      `${objectName}.${methodName}() on untrusted data can execute arbitrary code.`,
      sourceCode,
      'Never deserialize pickle data from untrusted sources. Use JSON or a safe format instead.',
    )
  },
}

// ---------------------------------------------------------------------------
// ssh-no-host-key-verification (Python)
// ---------------------------------------------------------------------------

export const pythonSshNoHostKeyVerificationVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssh-no-host-key-verification',
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

    // paramiko: client.set_missing_host_key_policy(AutoAddPolicy())
    if (methodName === 'set_missing_host_key_policy') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          const argText = arg.text
          if (argText.includes('AutoAddPolicy') || argText.includes('WarningPolicy')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'SSH without host key verification',
              `set_missing_host_key_policy(${argText}) bypasses host key verification, enabling MITM attacks.`,
              sourceCode,
              'Use RejectPolicy or known_hosts verification: client.set_missing_host_key_policy(paramiko.RejectPolicy()).',
            )
          }
        }
      }
    }

    // fabric/asyncssh: connect(host, known_hosts=None)
    if (methodName === 'connect' || methodName === 'SSHClient') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if ((name?.text === 'known_hosts' || name?.text === 'check_host_keys') &&
                (value?.text === 'None' || value?.text === "'ignore'" || value?.text === '"ignore"')) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'SSH without host key verification',
                `SSH connection with ${name.text}=${value.text} disables host key verification.`,
                sourceCode,
                'Provide a known_hosts file for host key verification.',
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
// unsafe-temp-file (Python)
// ---------------------------------------------------------------------------

const PYTHON_UNSAFE_TEMPFILE_FUNCTIONS = new Set(['mktemp', 'NamedTemporaryFile'])

export const pythonUnsafeTempFileVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-temp-file',
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

    // tempfile.mktemp() — insecure, race condition
    if (methodName === 'mktemp' && (objectName === 'tempfile' || objectName === '')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe temporary file creation',
        'tempfile.mktemp() is deprecated and insecure due to a TOCTOU race condition.',
        sourceCode,
        'Use tempfile.mkstemp() or tempfile.NamedTemporaryFile() instead.',
      )
    }

    // tempfile.NamedTemporaryFile(delete=False) without mode restriction
    if (methodName === 'NamedTemporaryFile' && (objectName === 'tempfile' || objectName === '')) {
      const args = node.childForFieldName('arguments')
      if (args) {
        let hasDeleteFalse = false
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if (name?.text === 'delete' && value?.text === 'False') {
              hasDeleteFalse = true
            }
          }
        }
        if (hasDeleteFalse) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Unsafe temporary file creation',
            'NamedTemporaryFile(delete=False) creates a persistent temp file that may not be cleaned up securely.',
            sourceCode,
            'Ensure the file is deleted securely after use, or use tempfile.mkstemp() and manage cleanup yourself.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// flask-secret-key-disclosed (Python)
// ---------------------------------------------------------------------------

export const pythonFlaskSecretKeyDisclosedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/flask-secret-key-disclosed',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    const leftText = left.text

    // app.secret_key = "hardcoded" or app.config['SECRET_KEY'] = "hardcoded"
    // or SECRET_KEY = "hardcoded"
    const isSecretKey = leftText === 'SECRET_KEY' ||
      leftText.endsWith('.secret_key') ||
      leftText.includes("['SECRET_KEY']") ||
      leftText.includes('["SECRET_KEY"]')

    if (!isSecretKey) return null

    // Flag if the value is a string literal
    if (right.type === 'string' || right.type === 'concatenated_string') {
      const val = right.text.replace(/^['"]+|['"]+$/g, '')
      // Ignore env var references
      if (!val.includes('environ') && !val.includes('getenv') && val.length >= 1) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Flask SECRET_KEY hardcoded',
          `Flask SECRET_KEY is hardcoded as a string literal. This compromises session security.`,
          sourceCode,
          'Load the SECRET_KEY from an environment variable: app.secret_key = os.environ["SECRET_KEY"].',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// django-raw-sql (Python)
// ---------------------------------------------------------------------------

export const pythonDjangoRawSqlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/django-raw-sql',
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

    if (methodName !== 'raw' && methodName !== 'extra') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag f-string interpolation or string concatenation in the SQL argument
    const isUnsafe =
      (firstArg.type === 'string' && firstArg.text.startsWith('f')) ||
      firstArg.type === 'binary_operator' ||
      firstArg.type === 'call' // e.g., format()

    if (isUnsafe || firstArg.type !== 'none') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Django raw SQL query',
        `${methodName}() bypasses Django ORM protections. Ensure the query is not built from user input.`,
        sourceCode,
        'Avoid raw() and extra(). Use Django ORM queryset methods or parameterized queries.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-markup (Python)
// ---------------------------------------------------------------------------

const UNSAFE_MARKUP_FUNCS = new Set(['Markup', 'mark_safe'])

export const pythonUnsafeMarkupVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-markup',
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

    if (!UNSAFE_MARKUP_FUNCS.has(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when the argument is not a plain string literal (could be user input)
    if (firstArg.type !== 'string' || firstArg.text.startsWith('f')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe HTML markup injection',
        `${funcName}() called with a non-literal argument. If the value contains user input, this enables XSS.`,
        sourceCode,
        'Never pass user-controlled data to Markup() or mark_safe(). Escape user input first.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// logging-config-insecure-listen (Python)
// ---------------------------------------------------------------------------

export const pythonLoggingConfigInsecureListenVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/logging-config-insecure-listen',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    const obj = fn.childForFieldName('object')

    if (attr?.text !== 'listen') return null

    // Check parent object is logging.config or config
    const objText = obj?.text ?? ''
    if (!objText.includes('config') && !objText.includes('logging')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Insecure logging config listener',
      `${objText}.listen() opens a network socket that can receive and apply arbitrary logging configuration.`,
      sourceCode,
      'Avoid logging.config.listen(). Use file-based configuration or authenticated configuration endpoints.',
    )
  },
}

// ---------------------------------------------------------------------------
// unsafe-torch-load (Python)
// ---------------------------------------------------------------------------

export const pythonUnsafeTorchLoadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-torch-load',
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
    if (objectName !== 'torch' && objectName !== '') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Must have at least one argument (the file path)
    if (args.namedChildren.length === 0) return null

    // Check if weights_only=True is set
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'weights_only' && value?.text === 'True') {
          return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe torch.load() call',
      'torch.load() without weights_only=True uses pickle, which can execute arbitrary code.',
      sourceCode,
      'Add weights_only=True: torch.load(path, weights_only=True).',
    )
  },
}

// ---------------------------------------------------------------------------
// paramiko-call (Python)
// ---------------------------------------------------------------------------

export const pythonParamikoCallVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/paramiko-call',
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

    if (methodName !== 'connect') return null

    // Check if the object's text suggests paramiko (e.g., client, ssh, paramiko)
    const nodeText = node.text
    if (!nodeText.includes('paramiko') && !nodeText.includes('SSHClient') && !nodeText.includes('client')) {
      return null
    }

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if look_for_keys or allow_agent are explicitly disabled along with missing host key check
    let hasAutoAddPolicy = false
    let parent = node.parent
    let depth = 0
    while (parent && depth < 10) {
      if (parent.text.includes('AutoAddPolicy') || parent.text.includes('WarningPolicy')) {
        hasAutoAddPolicy = true
        break
      }
      parent = parent.parent
      depth++
    }

    if (hasAutoAddPolicy) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Paramiko without host key verification',
        'Paramiko SSH client is connecting without strict host key verification (AutoAddPolicy or WarningPolicy).',
        sourceCode,
        'Use RejectPolicy or explicitly load known_hosts: client.load_system_host_keys().',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// suspicious-url-open (Python)
// ---------------------------------------------------------------------------

export const pythonSuspiciousUrlOpenVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/suspicious-url-open',
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

    if (methodName !== 'urlopen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when the URL is not a plain string literal (could be user-controlled)
    if (firstArg.type !== 'string' || firstArg.text.startsWith('f')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'urlopen with user-controlled URL',
        `${objectName ? objectName + '.' : ''}urlopen() called with a non-literal URL. User-controlled URLs enable SSRF.`,
        sourceCode,
        'Validate and allowlist URLs before passing them to urlopen().',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// redos-vulnerable-regex-python (Python)
// ---------------------------------------------------------------------------

// Patterns indicative of catastrophic backtracking: nested quantifiers like (a+)+, (a*)*
const REDOS_PATTERN = /\([^)]*[+*]\)[+*]|\([^)]*[+*]\)[{][0-9]/

export const pythonRedosVulnerableRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/redos-vulnerable-regex-python',
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

    if (objectName !== 're') return null
    if (!['compile', 'match', 'search', 'findall', 'fullmatch'].includes(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const pattern = firstArg.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (REDOS_PATTERN.test(pattern)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'ReDoS-vulnerable regex pattern',
        `Regex pattern "${pattern}" contains nested quantifiers that may cause catastrophic backtracking.`,
        sourceCode,
        'Simplify the regex or use possessive quantifiers. Consider using the `regex` library with atomic groups.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// fastapi-file-upload-body (Python)
// ---------------------------------------------------------------------------

export const pythonFastapiFileUploadBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/fastapi-file-upload-body',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Check parameters for UploadFile type annotation without size constraint
    for (const param of params.namedChildren) {
      const paramText = param.text
      if (/UploadFile/.test(paramText) && !/max_size|size_limit/.test(paramText)) {
        // Check if there's no max_size validation in the function body
        const body = node.childForFieldName('body')
        if (body && !/max_size|size_limit|content.length|\.size/.test(body.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'FastAPI file upload without size limit',
            'FastAPI endpoint accepts file uploads (UploadFile) without enforcing a maximum file size.',
            sourceCode,
            'Add a file size check: if file.size > MAX_SIZE: raise HTTPException(413).',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// snmp-insecure-version (Python)
// ---------------------------------------------------------------------------

export const pythonSnmpInsecureVersionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-insecure-version',
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

    if (methodName !== 'CommunityData' && methodName !== 'cmdgen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // CommunityData('community', mpModel=0) means SNMPv1, mpModel=1 means SNMPv2c
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'mpModel' && (value?.text === '0' || value?.text === '1')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'SNMP insecure version',
            `CommunityData with mpModel=${value?.text} uses SNMP v${value?.text === '0' ? '1' : '2c'} without encryption.`,
            sourceCode,
            'Use UsmUserData for SNMPv3 with authentication and encryption.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// s3-insecure-http (Python - boto3)
// ---------------------------------------------------------------------------

export const pythonS3InsecureHttpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-insecure-http',
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

    if (methodName !== 'client' && methodName !== 'resource') return null
    if (objectName !== 'boto3' && objectName !== '') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'use_ssl' && value?.text === 'False') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'S3 client without SSL',
            'boto3 client created with use_ssl=False. Data in transit will not be encrypted.',
            sourceCode,
            'Remove use_ssl=False to ensure encrypted communication with S3.',
          )
        }
        if (name?.text === 'endpoint_url' && value) {
          const url = value.text.replace(/['"]/g, '')
          if (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'S3 client without SSL',
              `boto3 client endpoint "${url}" uses HTTP instead of HTTPS.`,
              sourceCode,
              'Use an HTTPS endpoint URL for boto3 S3 clients.',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// s3-unrestricted-access (Python)
// ---------------------------------------------------------------------------

export const pythonS3UnrestrictedAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-unrestricted-access',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    if (val.includes('"Principal"') && val.includes('"*"')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'S3 bucket policy with wildcard principal',
        'S3 bucket policy string contains a wildcard principal (*), granting public access.',
        sourceCode,
        'Restrict the Principal to specific AWS accounts or IAM roles.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// long-term-aws-keys-in-code (Python)
// ---------------------------------------------------------------------------

const PYTHON_AWS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/

export const pythonLongTermAwsKeysInCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/long-term-aws-keys-in-code',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    if (PYTHON_AWS_KEY_PATTERN.test(val)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'AWS access key hardcoded',
        `Hardcoded AWS access key ID detected: "${val}". Use IAM roles or environment variables.`,
        sourceCode,
        'Remove the hardcoded key and use boto3 credential chain (env vars, IAM role, etc.).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// wildcard-in-os-command (Python)
// ---------------------------------------------------------------------------

export const pythonWildcardInOsCommandVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/wildcard-in-os-command',
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

    if (objectName !== 'os' || (methodName !== 'system' && methodName !== 'popen')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text
    if (/ \*/.test(argText) || /\*/.test(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wildcard in OS command',
        `Glob wildcard (*) in os.${methodName}() command can be exploited via specially named files.`,
        sourceCode,
        'Avoid wildcards in shell commands. Enumerate files explicitly using os.listdir() or pathlib.',
      )
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
  pythonWeakCipherVisitor,
  pythonWeakCryptoKeyVisitor,
  pythonWeakSslVisitor,
  pythonInsecureJwtVisitor,
  pythonEncryptionInsecureModeVisitor,
  pythonUnverifiedHostnameVisitor,
  pythonXmlXxeVisitor,
  pythonUnsafeUnzipVisitor,
  pythonFilePermissionsWorldAccessibleVisitor,
  pythonConfidentialInfoLoggingVisitor,
  pythonProductionDebugEnabledVisitor,
  pythonInsecureRandomVisitor,
  pythonSubprocessSecurityVisitor,
  pythonPartialPathExecutionVisitor,
  pythonSslVersionUnsafeVisitor,
  pythonVulnerableLibraryImportVisitor,
  pythonProcessStartNoShellVisitor,
  pythonNonOctalFilePermissionsVisitor,
  pythonUnsafeYamlLoadVisitor,
  pythonUnsafePickleUsageVisitor,
  pythonSshNoHostKeyVerificationVisitor,
  pythonUnsafeTempFileVisitor,
  pythonFlaskSecretKeyDisclosedVisitor,
  pythonDjangoRawSqlVisitor,
  pythonUnsafeMarkupVisitor,
  pythonLoggingConfigInsecureListenVisitor,
  pythonUnsafeTorchLoadVisitor,
  pythonParamikoCallVisitor,
  pythonSuspiciousUrlOpenVisitor,
  pythonRedosVulnerableRegexVisitor,
  pythonFastapiFileUploadBodyVisitor,
  pythonSnmpInsecureVersionVisitor,
  pythonS3InsecureHttpVisitor,
  pythonS3UnrestrictedAccessVisitor,
  pythonLongTermAwsKeysInCodeVisitor,
  pythonWildcardInOsCommandVisitor,
]
