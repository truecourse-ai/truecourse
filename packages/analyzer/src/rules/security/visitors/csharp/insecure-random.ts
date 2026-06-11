import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingFunction } from '../../../_shared/csharp-helpers.js'
import { getCreatedTypeName } from './_helpers.js'

/**
 * `new Random()` / `Random.Shared` in a security-sensitive context (token,
 * secret, password, OTP, nonce, salt generation). System.Random is
 * predictable; RandomNumberGenerator is the CSPRNG. Plain Random for
 * shuffling/jitter/test data is idiomatic and never flagged.
 */
const SECURITY_KEYWORDS = /(?:token|secret|password|passwd|otp|nonce|salt|api_?key|csrf|session_?id|reset_?code|verification_?code|activation_?code)/i

function isTestFile(filePath: string): boolean {
  // Match on the file NAME conventions, not directory path segments: a
  // repository fixture tree (e.g. tests/fixtures/...) is production-shaped
  // sample code, and a path-segment heuristic would wrongly suppress the rule
  // for every file beneath it.
  const fileName = filePath.replace(/^.*[\\/]/, '')
  return (
    /Tests?\.cs$/i.test(fileName) ||
    /(?:TestSetup|TestFixture|Fixtures?|FunctionalTests|IntegrationTests|UnitTests|TestHelpers?)/.test(fileName)
  )
}

const CONTEXT_BOUNDARY_TYPES = new Set([
  'expression_statement', 'local_declaration_statement', 'field_declaration',
  'return_statement', 'block', 'method_declaration',
])

function inSecuritySensitiveContext(node: SyntaxNode): boolean {
  // Names in the statement around the call: `var resetToken = ...new Random()...`
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (SECURITY_KEYWORDS.test(current.text.split('\n', 2)[0] ?? '')) return true
    if (CONTEXT_BOUNDARY_TYPES.has(current.type)) break
    current = current.parent
  }
  // The enclosing method's name: GenerateResetToken() { ... new Random() ... }
  const fn = getCSharpEnclosingFunction(node)
  if (fn?.type === 'method_declaration' || fn?.type === 'local_function_statement') {
    const name = fn.childForFieldName('name')?.text ?? fn.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    if (SECURITY_KEYWORDS.test(name)) return true
  }
  return false
}

export const csharpInsecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (isTestFile(filePath)) return null

    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'Random') return null
    } else {
      const receiver = node.childForFieldName('expression')
      const name = node.childForFieldName('name')
      if (receiver?.text !== 'Random' || name?.text !== 'Shared') return null
    }

    if (!inSecuritySensitiveContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Insecure random number generator',
      'System.Random is predictable and must not generate tokens, secrets, or other security values.',
      sourceCode,
      'Use RandomNumberGenerator.GetBytes()/GetInt32() (System.Security.Cryptography) for security-sensitive randomness.',
    )
  },
}
