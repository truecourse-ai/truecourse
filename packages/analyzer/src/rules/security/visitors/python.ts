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
]
