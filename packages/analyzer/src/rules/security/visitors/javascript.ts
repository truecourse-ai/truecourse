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

// ---------------------------------------------------------------------------
// csrf-disabled
// ---------------------------------------------------------------------------

export const csrfDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/csrf-disabled',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    // csrf: false
    if (key?.text === 'csrf' && value?.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'CSRF protection disabled',
        'Setting csrf to false disables Cross-Site Request Forgery protection.',
        sourceCode,
        'Enable CSRF protection to prevent cross-site request forgery attacks.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-cipher
// ---------------------------------------------------------------------------

const WEAK_CIPHERS = new Set(['des', 'des-ede', 'des-ede3', 'rc4', 'blowfish', 'bf', 'bf-cbc', 'bf-ecb'])

export const weakCipherVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-cipher',
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

    if (methodName !== 'createCipher' && methodName !== 'createCipheriv' && methodName !== 'createDecipher' && methodName !== 'createDecipheriv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    for (const cipher of WEAK_CIPHERS) {
      if (argText === cipher || argText.startsWith(cipher + '-')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak cipher algorithm',
          `Using weak cipher "${argText}". DES, RC4, and Blowfish are cryptographically broken.`,
          sourceCode,
          'Use AES-256-GCM or AES-256-CBC instead.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// weak-crypto-key
// ---------------------------------------------------------------------------

export const weakCryptoKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-crypto-key',
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

    if (methodName !== 'generateKeyPair' && methodName !== 'generateKeyPairSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const keyType = firstArg.text.replace(/['"]/g, '').toLowerCase()

    // Look for options object
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')

            // RSA: modulusLength < 2048
            if (keyType === 'rsa' && key?.text === 'modulusLength' && value) {
              const num = parseInt(value.text, 10)
              if (!isNaN(num) && num < 2048) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Weak cryptographic key size',
                  `RSA key size ${num} bits is too small. Minimum recommended is 2048 bits.`,
                  sourceCode,
                  'Use at least 2048-bit RSA keys (preferably 4096).',
                )
              }
            }

            // EC: namedCurve with small key
            if (keyType === 'ec' && key?.text === 'namedCurve' && value) {
              const curve = value.text.replace(/['"]/g, '').toLowerCase()
              // P-192 (secp192r1) and P-224 (secp224r1) are too small
              if (curve === 'secp192r1' || curve === 'p-192' || curve === 'prime192v1' ||
                  curve === 'secp224r1' || curve === 'p-224') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Weak cryptographic key size',
                  `EC curve "${curve}" provides less than 256 bits of security.`,
                  sourceCode,
                  'Use P-256 (secp256r1) or stronger curves.',
                )
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
// weak-ssl
// ---------------------------------------------------------------------------

const WEAK_TLS_PROTOCOLS = new Set([
  'sslv2_method', 'sslv3_method', 'sslv23_method',
  'tlsv1_method', 'tlsv1_0_method',
  'sslv2', 'sslv3', 'tlsv1', 'tlsv1.0',
])

export const weakSslVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-ssl',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'secureProtocol' && value) {
      const protocol = value.text.replace(/['"]/g, '').toLowerCase()
      if (WEAK_TLS_PROTOCOLS.has(protocol)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak SSL/TLS protocol',
          `Using deprecated protocol "${value.text.replace(/['"]/g, '')}". SSLv2, SSLv3, and TLS 1.0 are insecure.`,
          sourceCode,
          'Use TLS 1.2 or TLS 1.3 (e.g., TLS_method with minVersion set to TLSv1.2).',
        )
      }
    }

    if (key?.text === 'minVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak SSL/TLS protocol',
          'Setting minimum TLS version to 1.0 allows insecure connections.',
          sourceCode,
          'Set minVersion to "TLSv1.2" or higher.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-jwt
// ---------------------------------------------------------------------------

const INSECURE_JWT_ALGORITHMS = new Set(['none', 'hs256'])

export const insecureJwtVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-jwt',
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

    if (methodName !== 'sign' && methodName !== 'verify') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for options object with algorithm property
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if ((key?.text === 'algorithm' || key?.text === 'algorithms') && value) {
              const algText = value.text.replace(/['"]/g, '').toLowerCase()
              if (INSECURE_JWT_ALGORITHMS.has(algText)) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Insecure JWT configuration',
                  `JWT ${methodName}() with algorithm "${value.text.replace(/['"]/g, '')}" is insecure.`,
                  sourceCode,
                  'Use RS256, ES256, or another strong asymmetric algorithm for JWT signing.',
                )
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
// encryption-insecure-mode
// ---------------------------------------------------------------------------

export const encryptionInsecureModeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/encryption-insecure-mode',
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

    if (methodName !== 'createCipheriv' && methodName !== 'createDecipheriv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (argText.includes('ecb')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure encryption mode',
        `ECB mode ("${firstArg.text.replace(/['"]/g, '')}") does not provide semantic security. Identical plaintext blocks produce identical ciphertext.`,
        sourceCode,
        'Use GCM or CBC mode instead of ECB (e.g., aes-256-gcm).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-content-security-policy
// ---------------------------------------------------------------------------

export const missingContentSecurityPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-content-security-policy',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'contentSecurityPolicy' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Missing Content Security Policy',
                'Helmet configured with contentSecurityPolicy disabled. CSP helps prevent XSS attacks.',
                sourceCode,
                'Enable contentSecurityPolicy or configure a strict CSP.',
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
// missing-frame-ancestors
// ---------------------------------------------------------------------------

export const missingFrameAncestorsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-frame-ancestors',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'frameguard' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Missing frame ancestors protection',
                'Helmet configured with frameguard disabled. This removes clickjacking protection.',
                sourceCode,
                'Enable frameguard or set frame-ancestors in your CSP.',
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
// missing-strict-transport
// ---------------------------------------------------------------------------

export const missingStrictTransportVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-strict-transport',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'hsts' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Missing HSTS',
                'Helmet configured with HSTS disabled. HSTS prevents protocol downgrade attacks.',
                sourceCode,
                'Enable HSTS: helmet({ hsts: { maxAge: 31536000, includeSubDomains: true } }).',
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
// missing-referrer-policy
// ---------------------------------------------------------------------------

export const missingReferrerPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-referrer-policy',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'referrerPolicy' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Missing referrer policy',
                'Helmet configured with referrerPolicy disabled. This may leak sensitive URL information.',
                sourceCode,
                'Enable referrerPolicy: helmet({ referrerPolicy: { policy: "no-referrer" } }).',
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
// missing-mime-sniff-protection
// ---------------------------------------------------------------------------

export const missingMimeSniffProtectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-mime-sniff-protection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'helmet') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'noSniff' && value?.text === 'false') {
              return makeViolation(
                this.ruleKey, node, filePath, 'medium',
                'Missing MIME sniff protection',
                'Helmet configured with noSniff disabled. Browsers may misinterpret file types.',
                sourceCode,
                'Enable noSniff to set X-Content-Type-Options: nosniff.',
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
// server-fingerprinting
// ---------------------------------------------------------------------------

export const serverFingerprintingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/server-fingerprinting',
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

    // res.header('X-Powered-By', ...) or res.setHeader('X-Powered-By', ...)
    if (methodName === 'header' || methodName === 'setHeader' || methodName === 'set') {
      const args = node.childForFieldName('arguments')
      if (args && args.namedChildren.length >= 1) {
        const headerName = args.namedChildren[0]?.text.replace(/['"]/g, '').toLowerCase()
        if (headerName === 'x-powered-by') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Server fingerprinting',
            'Setting X-Powered-By header reveals server technology to attackers.',
            sourceCode,
            'Remove the X-Powered-By header. Use app.disable("x-powered-by") in Express.',
          )
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unverified-hostname
// ---------------------------------------------------------------------------

export const unverifiedHostnameVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-hostname',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'checkServerIdentity' && value) {
      // checkServerIdentity: () => undefined  or  checkServerIdentity: function() {}
      if (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unverified hostname',
          'Custom checkServerIdentity disables TLS hostname verification.',
          sourceCode,
          'Remove the custom checkServerIdentity to use the default hostname verification.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// xml-xxe
// ---------------------------------------------------------------------------

const XML_PARSE_FUNCTIONS = new Set(['parseString', 'parseStringPromise', 'parseXml'])

export const xmlXxeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xml-xxe',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression', 'call_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor')
      if (!constructor) return null

      if (constructor.text === 'DOMParser') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'XML external entity injection',
          'DOMParser may be vulnerable to XXE attacks. Ensure external entities are disabled.',
          sourceCode,
          'Use a secure XML parser or disable external entity resolution.',
        )
      }
    }

    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function')
      if (!fn) return null

      let funcName = ''
      if (fn.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop) funcName = prop.text
      } else if (fn.type === 'identifier') {
        funcName = fn.text
      }

      if (XML_PARSE_FUNCTIONS.has(funcName)) {
        // Check if options argument disables entities
        const args = node.childForFieldName('arguments')
        if (args) {
          // If there's no second argument (options), flag it
          if (args.namedChildren.length < 2) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'XML external entity injection',
              `${funcName}() called without explicitly disabling external entities.`,
              sourceCode,
              'Pass options to disable external entity resolution (e.g., { xmldec: { noent: false } }).',
            )
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unsafe-unzip
// ---------------------------------------------------------------------------

const UNZIP_SPECIFIC_METHODS = new Set(['extractAllTo', 'extractAllToAsync', 'extractEntryTo'])

export const unsafeUnzipVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-unzip',
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

    // extractAllTo, extractAllToAsync, extractEntryTo — always archive-specific
    if (UNZIP_SPECIFIC_METHODS.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe archive extraction',
        `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
        sourceCode,
        'Validate archive entry sizes and count before extraction. Set extraction limits.',
      )
    }

    // extract() — only flag when the object name suggests an archive context
    if (methodName === 'extract' && objectName) {
      const lower = objectName.toLowerCase()
      if (lower.includes('zip') || lower.includes('tar') || lower.includes('archive')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe archive extraction',
          `${methodName}() extracts archive contents without size/count limits. Risk of zip bomb attack.`,
          sourceCode,
          'Validate archive entry sizes and count before extraction. Set extraction limits.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// file-permissions-world-accessible (JS)
// ---------------------------------------------------------------------------

const WORLD_PERMS = new Set(['0o777', '0o776', '0o766', '0o667', '0o666'])

export const filePermissionsWorldAccessibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/file-permissions-world-accessible',
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

    if (methodName !== 'chmod' && methodName !== 'chmodSync' && methodName !== 'writeFile' && methodName !== 'writeFileSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // For chmod/chmodSync: second arg is mode; for writeFile: options object or third arg
    for (const arg of args.namedChildren) {
      const t = arg.text.toLowerCase()
      if (WORLD_PERMS.has(t) || t === '511' || t === '438') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'World-accessible file permissions',
          `${methodName}() sets overly permissive file permissions (${arg.text}).`,
          sourceCode,
          'Use restrictive permissions like 0o600 or 0o644.',
        )
      }
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'mode' && value) {
              const vt = value.text.toLowerCase()
              if (WORLD_PERMS.has(vt) || vt === '511' || vt === '438') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'World-accessible file permissions',
                  `${methodName}() sets overly permissive file permissions (${value.text}).`,
                  sourceCode,
                  'Use restrictive permissions like 0o600 or 0o644.',
                )
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
// unrestricted-file-upload (JS)
// ---------------------------------------------------------------------------

export const unrestrictedFileUploadVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unrestricted-file-upload',
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

    if (funcName !== 'multer') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if fileFilter is provided in the options object
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            if (key?.text === 'fileFilter') return null
          }
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unrestricted file upload',
      'multer() configured without fileFilter. Any file type can be uploaded.',
      sourceCode,
      'Add a fileFilter option to validate file types and sizes.',
    )
  },
}

// ---------------------------------------------------------------------------
// hidden-file-exposure (JS)
// ---------------------------------------------------------------------------

export const hiddenFileExposureVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hidden-file-exposure',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // express.static(path) or static(path)
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

    if (methodName !== 'static') return null
    // Only flag express.static
    if (fn.type === 'member_expression' && objectName !== 'express') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for options object with dotfiles: 'deny'
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')
            if (key?.text === 'dotfiles') {
              const val = value?.text.replace(/['"]/g, '').toLowerCase()
              if (val === 'deny' || val === 'ignore') return null
            }
          }
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hidden file exposure',
      'express.static() serves dotfiles by default. Files like .env or .git may be exposed.',
      sourceCode,
      'Add { dotfiles: "deny" } option to express.static().',
    )
  },
}

// ---------------------------------------------------------------------------
// link-target-blank (JSX)
// ---------------------------------------------------------------------------

export const linkTargetBlankVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/link-target-blank',
  languages: ['tsx'],
  nodeTypes: ['jsx_self_closing_element', 'jsx_opening_element'],
  visit(node, filePath, sourceCode) {
    // Check if it's an <a> tag
    const tagName = node.namedChildren[0]
    if (!tagName || tagName.text !== 'a') return null

    let hasTargetBlank = false
    let hasRelNoopener = false

    for (const child of node.namedChildren) {
      if (child.type === 'jsx_attribute') {
        const attrName = child.namedChildren[0]
        if (!attrName) continue

        if (attrName.text === 'target') {
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '').toLowerCase()
            if (val === '_blank') hasTargetBlank = true
          }
        }

        if (attrName.text === 'rel') {
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '').toLowerCase()
            if (val.includes('noopener')) hasRelNoopener = true
          }
        }
      }
    }

    if (hasTargetBlank && !hasRelNoopener) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe target="_blank" link',
        '<a target="_blank"> without rel="noopener" allows reverse tabnabbing attacks.',
        sourceCode,
        'Add rel="noopener noreferrer" to links with target="_blank".',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// confidential-info-logging (JS)
// ---------------------------------------------------------------------------

const JS_LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace'])
const SENSITIVE_VAR_PATTERNS = /(?:password|passwd|secret|token|apiKey|api_key|private_key|privateKey|credential|mnemonic)/i

export const confidentialInfoLoggingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/confidential-info-logging',
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
    }

    if (!JS_LOG_METHODS.has(methodName)) return null
    if (objectName !== 'console' && objectName !== 'logger' && objectName !== 'log') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'identifier' && SENSITIVE_VAR_PATTERNS.test(arg.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Confidential info logging',
          `Logging sensitive variable "${arg.text}". This may expose secrets in logs.`,
          sourceCode,
          'Remove sensitive data from log statements or redact it.',
        )
      }
      if (arg.type === 'member_expression') {
        const prop = arg.childForFieldName('property')
        if (prop && SENSITIVE_VAR_PATTERNS.test(prop.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Confidential info logging',
            `Logging sensitive property "${prop.text}". This may expose secrets in logs.`,
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
// production-debug-enabled (JS)
// ---------------------------------------------------------------------------

export const productionDebugEnabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/production-debug-enabled',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'debug' && value?.text === 'true') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Production debug enabled',
        'Debug mode is enabled in configuration. This may leak sensitive information.',
        sourceCode,
        'Set debug to false in production configurations.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// insecure-random (JS)
// ---------------------------------------------------------------------------

export const insecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Math' && prop?.text === 'random') {
        // Check if it's in a security-sensitive context by looking at ancestors
        let parent = node.parent
        while (parent) {
          const parentText = parent.text.toLowerCase()
          if (parentText.includes('token') || parentText.includes('secret') ||
              parentText.includes('key') || parentText.includes('nonce') ||
              parentText.includes('salt') || parentText.includes('csrf') ||
              parentText.includes('password') || parentText.includes('session')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Insecure random number generator',
              'Math.random() is not cryptographically secure. Do not use it for tokens, keys, or secrets.',
              sourceCode,
              'Use crypto.randomBytes() or crypto.randomUUID() instead.',
            )
          }
          if (parent.type === 'expression_statement' || parent.type === 'variable_declaration' ||
              parent.type === 'assignment_expression' || parent.type === 'lexical_declaration') break
          parent = parent.parent
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ip-forwarding (JS)
// ---------------------------------------------------------------------------

export const ipForwardingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ip-forwarding',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    const index = node.childForFieldName('index')

    if (!obj || !index) return null

    const indexText = index.text.replace(/['"]/g, '').toLowerCase()
    if (indexText !== 'x-forwarded-for') return null

    // Check that it's accessing headers
    if (obj.text.includes('headers')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Untrusted IP forwarding header',
        'Accessing X-Forwarded-For header directly. This header can be spoofed by clients.',
        sourceCode,
        'Use a trusted proxy configuration (e.g., app.set("trust proxy")) and req.ip instead.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// dompurify-unsafe-config (JS)
// ---------------------------------------------------------------------------

const UNSAFE_DOMPURIFY_OPTIONS = new Set(['ALLOW_UNKNOWN_PROTOCOLS', 'ADD_TAGS', 'ADD_ATTR'])

export const dompurifyUnsafeConfigVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/dompurify-unsafe-config',
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

    if (methodName !== 'sanitize') return null
    if (objectName !== 'DOMPurify' && objectName !== 'dompurify') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            if (key && UNSAFE_DOMPURIFY_OPTIONS.has(key.text)) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'DOMPurify unsafe configuration',
                `DOMPurify.sanitize() with ${key.text} weakens sanitization and may allow XSS.`,
                sourceCode,
                'Remove unsafe DOMPurify options like ALLOW_UNKNOWN_PROTOCOLS and ADD_TAGS.',
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
// disabled-resource-integrity (JSX)
// ---------------------------------------------------------------------------

export const disabledResourceIntegrityVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-resource-integrity',
  languages: ['tsx'],
  nodeTypes: ['jsx_self_closing_element', 'jsx_opening_element'],
  visit(node, filePath, sourceCode) {
    const tagName = node.namedChildren[0]
    if (!tagName || (tagName.text !== 'script' && tagName.text !== 'link')) return null

    let hasSrc = false
    let hasIntegrity = false
    let isExternal = false

    for (const child of node.namedChildren) {
      if (child.type === 'jsx_attribute') {
        const attrName = child.namedChildren[0]
        if (!attrName) continue

        if (attrName.text === 'src' || attrName.text === 'href') {
          hasSrc = true
          const attrValue = child.namedChildren[1]
          if (attrValue) {
            const val = attrValue.text.replace(/['"{}]/g, '')
            if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) {
              isExternal = true
            }
          }
        }

        if (attrName.text === 'integrity') {
          hasIntegrity = true
        }
      }
    }

    if (hasSrc && isExternal && !hasIntegrity) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing subresource integrity',
        `<${tagName.text}> loads an external resource without an integrity attribute. A compromised CDN could serve malicious code.`,
        sourceCode,
        'Add an integrity attribute with the resource hash (e.g., integrity="sha384-...").',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// path-command-injection (JS)
// ---------------------------------------------------------------------------

export const pathCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/path-command-injection',
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
    }

    if (objectName !== 'path' || methodName !== 'join') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if any argument references user input patterns
    for (const arg of args.namedChildren) {
      const argText = arg.text.toLowerCase()
      if (argText.includes('req.') || argText.includes('params') ||
          argText.includes('query') || argText.includes('body') ||
          argText.includes('userinput') || argText.includes('user_input')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Path-based command injection',
          'path.join() with user-controlled input may allow path traversal attacks.',
          sourceCode,
          'Validate and sanitize user input before using it in file paths. Use path.resolve() and verify the result is within the expected directory.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// mixed-content (JSX)
// ---------------------------------------------------------------------------

export const mixedContentVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mixed-content',
  languages: ['tsx'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    const attrName = node.namedChildren[0]
    if (!attrName) return null

    if (attrName.text !== 'src' && attrName.text !== 'href' && attrName.text !== 'action') return null

    const attrValue = node.namedChildren[1]
    if (!attrValue) return null

    const val = attrValue.text.replace(/['"{}]/g, '')
    if (val.startsWith('http://') && !val.startsWith('http://localhost') && !val.startsWith('http://127.0.0.1')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mixed content',
        `Loading HTTP resource "${val}" in a JSX attribute. This causes mixed content warnings and security issues on HTTPS pages.`,
        sourceCode,
        'Use HTTPS URLs or protocol-relative URLs (//) for external resources.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// ssl-version-unsafe (JS)
// ---------------------------------------------------------------------------

export const sslVersionUnsafeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssl-version-unsafe',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'minVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0' || version === 'tlsv1.1') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe SSL/TLS minimum version',
          `Minimum TLS version set to "${value.text.replace(/['"]/g, '')}". TLS 1.0 and 1.1 are deprecated.`,
          sourceCode,
          'Set minVersion to "TLSv1.2" or higher.',
        )
      }
    }

    if (key?.text === 'maxVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0' || version === 'tlsv1.1') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe SSL/TLS minimum version',
          `Maximum TLS version set to "${value.text.replace(/['"]/g, '')}". This prevents use of modern TLS.`,
          sourceCode,
          'Set maxVersion to "TLSv1.3" or remove the restriction.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// unverified-cross-origin-message (JS)
// ---------------------------------------------------------------------------

export const unverifiedCrossOriginMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-cross-origin-message',
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

    if (methodName !== 'addEventListener') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const eventType = firstArg.text.replace(/['"]/g, '')
    if (eventType !== 'message') return null

    // Get the handler function
    const handler = args.namedChildren[1]
    if (!handler) return null

    // Check if the handler body references .origin
    const handlerText = handler.text
    if (!handlerText.includes('origin')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unverified cross-origin message',
        'Message event listener without origin verification. Any window can send messages.',
        sourceCode,
        'Check event.origin against a trusted list before processing the message.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// intrusive-permissions (JS)
// ---------------------------------------------------------------------------

const DANGEROUS_PERMISSIONS = new Set(['geolocation', 'camera', 'microphone', 'notifications', 'push'])

export const intrusivePermissionsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/intrusive-permissions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // navigator.permissions.query({ name: 'geolocation' })
    // navigator.geolocation.getCurrentPosition(...)
    // navigator.mediaDevices.getUserMedia(...)
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (!prop || !obj) return null

      if (prop.text === 'getUserMedia') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Intrusive permissions request',
          'getUserMedia() requests camera/microphone access. Ensure the user is informed before requesting.',
          sourceCode,
          'Request permissions only when necessary and explain the purpose to the user.',
        )
      }

      if (prop.text === 'getCurrentPosition' || prop.text === 'watchPosition') {
        const objText = obj.text
        if (objText.includes('geolocation') || objText.includes('navigator')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Intrusive permissions request',
            `${prop.text}() requests geolocation access. Ensure the user is informed before requesting.`,
            sourceCode,
            'Request permissions only when necessary and explain the purpose to the user.',
          )
        }
      }

      if (prop.text === 'query' && obj.type === 'member_expression') {
        const innerProp = obj.childForFieldName('property')
        if (innerProp?.text === 'permissions') {
          const args = node.childForFieldName('arguments')
          if (args) {
            for (const arg of args.namedChildren) {
              if (arg.type === 'object') {
                for (const pair of arg.namedChildren) {
                  if (pair.type === 'pair') {
                    const key = pair.childForFieldName('key')
                    const value = pair.childForFieldName('value')
                    if (key?.text === 'name' && value) {
                      const permName = value.text.replace(/['"]/g, '').toLowerCase()
                      if (DANGEROUS_PERMISSIONS.has(permName)) {
                        return makeViolation(
                          this.ruleKey, node, filePath, 'medium',
                          'Intrusive permissions request',
                          `Querying "${permName}" permission. Ensure the user is informed before requesting.`,
                          sourceCode,
                          'Request permissions only when necessary and explain the purpose to the user.',
                        )
                      }
                    }
                  }
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
// session-not-regenerated (JS)
// ---------------------------------------------------------------------------

export const sessionNotRegeneratedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/session-not-regenerated',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for login-like functions that don't call req.session.regenerate()
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (!prop || !obj) return null

      // req.session.save() or req.session.destroy() in a login handler
      // without regenerate() being called — detect direct session assignment after auth
      // Pattern: req.session.userId = ... or req.session.user = ... without regenerate
      if (prop.text === 'save' && obj.type === 'member_expression') {
        const sessionProp = obj.childForFieldName('property')
        if (sessionProp?.text === 'session') {
          // Walk up to the nearest route handler function body and check for regenerate
          let parent = node.parent
          let routeText = ''
          while (parent) {
            // Collect all ancestor blocks until we reach a function that looks like a route handler
            if (parent.type === 'arrow_function' || parent.type === 'function_expression' ||
                parent.type === 'function_declaration') {
              // Keep walking up to find enclosing route-level function
              routeText = parent.text
              // If this function's parent is a call_expression argument list, it's likely a callback/route handler
              if (parent.parent?.type === 'arguments' || parent.parent?.type === 'call_expression') {
                // Check whether the surrounding call chain includes regenerate
                let ancestor = parent.parent
                while (ancestor) {
                  if (ancestor.text.includes('regenerate')) break
                  if (ancestor.type === 'program' || ancestor.type === 'module') {
                    return makeViolation(
                      this.ruleKey, node, filePath, 'high',
                      'Session not regenerated after login',
                      'req.session.save() called without regenerating the session ID. This risks session fixation attacks.',
                      sourceCode,
                      'Call req.session.regenerate() before saving session data after login.',
                    )
                  }
                  ancestor = ancestor.parent!
                }
                return null
              }
            }
            if (parent.type === 'program' || parent.type === 'module') break
            parent = parent.parent!
          }
        }
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// publicly-writable-directory (JS)
// ---------------------------------------------------------------------------

const TMP_PATH_PATTERNS = ['/tmp/', '/var/tmp/', '/dev/shm/']

export const publiclyWritableDirectoryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/publicly-writable-directory',
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

    if (methodName !== 'writeFile' && methodName !== 'writeFileSync' &&
        methodName !== 'appendFile' && methodName !== 'appendFileSync' &&
        methodName !== 'open' && methodName !== 'openSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pathText = firstArg.text.replace(/['"]/g, '')
    for (const tmpPath of TMP_PATH_PATTERNS) {
      if (pathText.startsWith(tmpPath) || pathText.includes(tmpPath)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Writing to world-writable directory',
          `${methodName}() writes to "${pathText}" which is a world-writable directory. Race conditions may allow attackers to hijack the file.`,
          sourceCode,
          'Use os.tmpdir() with a uniquely named file, or use a library like tmp or tempfile for secure temp file creation.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// dynamically-constructed-template (JS)
// ---------------------------------------------------------------------------

const TEMPLATE_ENGINE_METHODS = new Set(['render', 'compile', 'template', 'renderString', 'renderFile'])

export const dynamicallyConstructedTemplateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/dynamically-constructed-template',
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

    if (!TEMPLATE_ENGINE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag if the first arg is a template literal with user-input substitution
    if (firstArg.type === 'template_string') {
      const hasSubstitution = firstArg.namedChildren.some((c) => c.type === 'template_substitution')
      if (hasSubstitution) {
        const argText = firstArg.text.toLowerCase()
        if (argText.includes('req.') || argText.includes('params') ||
            argText.includes('query') || argText.includes('body') ||
            argText.includes('input') || argText.includes('user')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Dynamically constructed template',
            `${methodName}() called with a template string containing user-controlled input. This may enable Server-Side Template Injection (SSTI).`,
            sourceCode,
            'Never construct template strings from user input. Pass user data as template variables instead.',
          )
        }
      }
    }

    // Flag if the first arg is a binary_expression (concatenation) including req. access
    if (firstArg.type === 'binary_expression') {
      const argText = firstArg.text.toLowerCase()
      if (argText.includes('req.') || argText.includes('params') ||
          argText.includes('query') || argText.includes('body')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Dynamically constructed template',
          `${methodName}() called with a concatenated string containing user-controlled input. This may enable SSTI.`,
          sourceCode,
          'Never construct template strings from user input. Pass user data as template variables instead.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// angular-sanitization-bypass (JS/TS)
// ---------------------------------------------------------------------------

const ANGULAR_BYPASS_METHODS = new Set([
  'bypassSecurityTrustHtml',
  'bypassSecurityTrustStyle',
  'bypassSecurityTrustScript',
  'bypassSecurityTrustUrl',
  'bypassSecurityTrustResourceUrl',
])

export const angularSanitizationBypassVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/angular-sanitization-bypass',
  languages: ['typescript', 'javascript'],
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

    if (ANGULAR_BYPASS_METHODS.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Angular sanitization bypass',
        `${methodName}() disables Angular's built-in XSS protection. Ensure input is sanitized manually.`,
        sourceCode,
        'Avoid bypassSecurityTrust* methods. If required, ensure all input is thoroughly sanitized first.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// session-cookie-on-static (JS)
// ---------------------------------------------------------------------------

export const sessionCookieOnStaticVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/session-cookie-on-static',
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
    }

    // app.use('/static', session(...), express.static(...))
    // Detect app.use(path, session, static) pattern
    if (methodName !== 'use') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length < 2) return null

    const firstArg = args.namedChildren[0]
    // First arg should be a static-like path
    if (firstArg?.type !== 'string') return null
    const routePath = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (!routePath.includes('static') && !routePath.includes('assets') &&
        !routePath.includes('public') && !routePath.includes('css') &&
        !routePath.includes('js') && !routePath.includes('images')) return null

    // Check if session middleware is also in the args
    const middlewareText = args.namedChildren.slice(1).map((n) => n.text).join(' ')
    if (middlewareText.includes('session(') || middlewareText.includes('cookieSession(')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Session middleware on static routes',
        `Session middleware applied to static route "${routePath}". This creates unnecessary session overhead.`,
        sourceCode,
        'Remove session middleware from static file routes.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// user-id-from-request-body (JS)
// ---------------------------------------------------------------------------

export const userIdFromRequestBodyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-id-from-request-body',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    // Detect req.body.userId, req.body.user_id, req.body.id patterns
    const obj = node.childForFieldName('object')
    const prop = node.childForFieldName('property')

    if (!obj || !prop) return null

    const propText = prop.text.toLowerCase()
    if (propText !== 'userid' && propText !== 'user_id' && propText !== 'accountid' && propText !== 'account_id') return null

    if (obj.type === 'member_expression') {
      const outerObj = obj.childForFieldName('object')
      const outerProp = obj.childForFieldName('property')
      if (outerObj?.text === 'req' && outerProp?.text === 'body') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'User ID from request body',
          `Using ${node.text} as user identity. Client-supplied IDs can be forged.`,
          sourceCode,
          'Use the authenticated user identity from req.user or the session token instead of req.body.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// mass-assignment (JS)
// ---------------------------------------------------------------------------

const ORM_CREATE_METHODS = new Set(['create', 'update', 'updateOne', 'updateMany', 'findOneAndUpdate', 'save', 'insert', 'insertOne'])

export const massAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/mass-assignment',
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

    if (!ORM_CREATE_METHODS.has(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for req.body or spread of req.body directly as the first/second argument
    for (const arg of args.namedChildren) {
      if (arg.type === 'member_expression') {
        const obj = arg.childForFieldName('object')
        const prop = arg.childForFieldName('property')
        if (obj?.text === 'req' && prop?.text === 'body') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Mass assignment vulnerability',
            `${methodName}() called directly with req.body. Attackers can set arbitrary fields.`,
            sourceCode,
            'Use an allowlist to pick only expected fields: const { name, email } = req.body.',
          )
        }
      }
      // Spread of req.body: { ...req.body }
      if (arg.type === 'object') {
        for (const child of arg.namedChildren) {
          if (child.type === 'spread_element') {
            const spreadText = child.text
            if (spreadText.includes('req.body')) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'Mass assignment vulnerability',
                `${methodName}() called with spread of req.body. Attackers can set arbitrary fields.`,
                sourceCode,
                'Use an allowlist to pick only expected fields: const { name, email } = req.body.',
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
// timing-attack-comparison (JS)
// ---------------------------------------------------------------------------

const SENSITIVE_COMPARISON_PATTERNS = /(?:token|secret|hmac|signature|apikey|api_key|hash|digest|password|passwd)/i

export const timingAttackComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/timing-attack-comparison',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.type === '===' || c.type === '!==')

    if (!operator || !left || !right) return null

    // Check if either side references a sensitive variable name
    const leftText = left.text
    const rightText = right.text

    if (SENSITIVE_COMPARISON_PATTERNS.test(leftText) || SENSITIVE_COMPARISON_PATTERNS.test(rightText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Timing attack via string comparison',
        `Using ${operator.text} to compare what may be a secret/token. This is vulnerable to timing attacks.`,
        sourceCode,
        'Use crypto.timingSafeEqual() for comparing secrets and tokens.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// user-input-in-path (JS)
// ---------------------------------------------------------------------------

const FS_READ_WRITE_METHODS = new Set([
  'readFile', 'readFileSync', 'writeFile', 'writeFileSync',
  'readdir', 'readdirSync', 'unlink', 'unlinkSync',
  'stat', 'statSync', 'access', 'accessSync',
  'open', 'openSync', 'createReadStream', 'createWriteStream',
])

export const userInputInPathVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-path',
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

    if (!FS_READ_WRITE_METHODS.has(methodName)) return null
    // Skip path.join — covered by path-command-injection
    if (objectName === 'path') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.toLowerCase()
    if (argText.includes('req.') || argText.includes('req[') ||
        argText.includes('params') || argText.includes('query') ||
        argText.includes('body') || argText.includes('userinput') ||
        argText.includes('user_input') || argText.includes('filename')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'User input in file path',
        `${methodName}() called with user-controlled path. This may allow path traversal attacks.`,
        sourceCode,
        'Validate and sanitize file paths. Use path.resolve() and verify the result stays within the expected directory.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// user-input-in-redirect (JS)
// ---------------------------------------------------------------------------

export const userInputInRedirectVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-redirect',
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

    if (methodName !== 'redirect') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check all arguments for user input
    for (const arg of args.namedChildren) {
      const argText = arg.text.toLowerCase()
      if (argText.includes('req.') || argText.includes('params') ||
          argText.includes('query') || argText.includes('body') ||
          argText.includes('userinput') || argText.includes('user_input') ||
          argText.includes('returnurl') || argText.includes('return_url') ||
          argText.includes('redirecturl') || argText.includes('redirect_url')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'User input in redirect URL',
          'res.redirect() called with user-controlled URL. This allows open redirect attacks.',
          sourceCode,
          'Validate redirect URLs against an allowlist of trusted domains before redirecting.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// missing-helmet-middleware (JS)
// ---------------------------------------------------------------------------

export const missingHelmetMiddlewareVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/missing-helmet-middleware',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Detect express() initialization
    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'express') return null

    // Look at the surrounding block for app.use(helmet())
    let parent = node.parent
    let blockText = ''
    while (parent) {
      if (parent.type === 'program' || parent.type === 'module') {
        blockText = parent.text
        break
      }
      parent = parent.parent
    }

    if (blockText && !blockText.includes('helmet')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing helmet middleware',
        'Express app initialized without helmet middleware. Security headers are not set.',
        sourceCode,
        'Add helmet: app.use(helmet()) to set security headers.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// jwt-no-expiry (JS)
// ---------------------------------------------------------------------------

export const jwtNoExpiryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-no-expiry',
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

    if (methodName !== 'sign') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // jwt.sign(payload, secret) — only two args, no options
    if (args.namedChildren.length < 3) {
      // Make sure it's likely jwt by checking for sign pattern
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'JWT signed without expiration',
        'jwt.sign() called without options. JWTs without expiresIn never expire.',
        sourceCode,
        'Add an expiresIn option: jwt.sign(payload, secret, { expiresIn: "1h" }).',
      )
    }

    // jwt.sign(payload, secret, options) — check if expiresIn is absent
    const optionsArg = args.namedChildren[2]
    if (optionsArg?.type === 'object') {
      let hasExpiresIn = false
      for (const prop of optionsArg.namedChildren) {
        if (prop.type === 'pair') {
          const key = prop.childForFieldName('key')
          if (key?.text === 'expiresIn') {
            hasExpiresIn = true
            break
          }
        }
      }
      if (!hasExpiresIn) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'JWT signed without expiration',
          'jwt.sign() options do not include expiresIn. JWTs without expiry never expire.',
          sourceCode,
          'Add expiresIn to the options: { expiresIn: "1h" }.',
        )
      }
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// sensitive-data-in-url (JS)
// ---------------------------------------------------------------------------

const SENSITIVE_URL_PARAMS = /[?&](password|passwd|secret|token|api_?key|auth|access_token|refresh_token)=/i

export const sensitiveDataInUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sensitive-data-in-url',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string', 'template_string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    const stripped = text.replace(/^['"`]|['"`]$/g, '')

    if (SENSITIVE_URL_PARAMS.test(stripped)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Sensitive data in URL',
        'Password or token found in URL query parameter. URLs are logged in server logs and browser history.',
        sourceCode,
        'Send sensitive data in the request body or Authorization header instead of URL query parameters.',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// express-trust-proxy-not-set (JS)
// ---------------------------------------------------------------------------

export const expressTrustProxyNotSetVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/express-trust-proxy-not-set',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Look for app.set('trust proxy', ...) calls
    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'set') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length < 2) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const settingName = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (settingName !== 'trust proxy') return null

    const valueArg = args.namedChildren[1]
    if (!valueArg) return null

    // Flag if trust proxy is set to false or 0
    if (valueArg.text === 'false' || valueArg.text === '0') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Express trust proxy not configured',
        'app.set("trust proxy", false) disables proxy trust. If this app is behind a reverse proxy, IP detection will be incorrect.',
        sourceCode,
        'Set trust proxy to the number of proxies or a specific IP: app.set("trust proxy", 1).',
      )
    }

    return null
  },
}

// ---------------------------------------------------------------------------
// hardcoded-password-function-arg (JS)
// ---------------------------------------------------------------------------

const PASSWORD_FUNCTION_NAMES = /(?:login|authenticate|connect|bind|createConnection|createClient|auth|verify|checkPassword|comparePassword)/i
const PLAINTEXT_PASSWORD_PATTERN = /^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};':",.<>?/\\|`~]{8,}$/

export const hardcodedPasswordFunctionArgVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-password-function-arg',
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

    if (!PASSWORD_FUNCTION_NAMES.test(funcName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'string') {
        const val = arg.text.replace(/['"]/g, '')
        if (val.length >= 8 && PLAINTEXT_PASSWORD_PATTERN.test(val) &&
            !/^https?:\/\//.test(val) && !/localhost/.test(val)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Hardcoded password as function argument',
            `${funcName}() called with a hardcoded string that looks like a password.`,
            sourceCode,
            'Move credentials to environment variables and reference them via process.env.',
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
  csrfDisabledVisitor,
  weakCipherVisitor,
  weakCryptoKeyVisitor,
  weakSslVisitor,
  insecureJwtVisitor,
  encryptionInsecureModeVisitor,
  missingContentSecurityPolicyVisitor,
  missingFrameAncestorsVisitor,
  missingStrictTransportVisitor,
  missingReferrerPolicyVisitor,
  missingMimeSniffProtectionVisitor,
  serverFingerprintingVisitor,
  unverifiedHostnameVisitor,
  xmlXxeVisitor,
  unsafeUnzipVisitor,
  filePermissionsWorldAccessibleVisitor,
  unrestrictedFileUploadVisitor,
  hiddenFileExposureVisitor,
  linkTargetBlankVisitor,
  confidentialInfoLoggingVisitor,
  productionDebugEnabledVisitor,
  insecureRandomVisitor,
  ipForwardingVisitor,
  dompurifyUnsafeConfigVisitor,
  disabledResourceIntegrityVisitor,
  pathCommandInjectionVisitor,
  mixedContentVisitor,
  sslVersionUnsafeVisitor,
  unverifiedCrossOriginMessageVisitor,
  intrusivePermissionsVisitor,
  sessionNotRegeneratedVisitor,
  publiclyWritableDirectoryVisitor,
  dynamicallyConstructedTemplateVisitor,
  angularSanitizationBypassVisitor,
  sessionCookieOnStaticVisitor,
  userIdFromRequestBodyVisitor,
  massAssignmentVisitor,
  timingAttackComparisonVisitor,
  userInputInPathVisitor,
  userInputInRedirectVisitor,
  missingHelmetMiddlewareVisitor,
  jwtNoExpiryVisitor,
  sensitiveDataInUrlVisitor,
  expressTrustProxyNotSetVisitor,
  hardcodedPasswordFunctionArgVisitor,
]
