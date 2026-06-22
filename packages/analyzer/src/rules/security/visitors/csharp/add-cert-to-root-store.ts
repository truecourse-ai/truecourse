import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCallArgs, getCreatedTypeName, lastSegment } from './_helpers.js'

/**
 * `new X509Store(StoreName.Root, ...)` — opening the Trusted Root Certification
 * Authorities store. Code that targets the Root store is positioning itself to
 * add a CA the whole machine then trusts, dangerously broadening trust.
 */
export const csharpAddCertToRootStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/add-cert-to-root-store',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCreatedTypeName(node) !== 'X509Store') return null
    const firstArg = getCallArgs(node)[0]?.value
    if (!firstArg || firstArg.type !== 'member_access_expression') return null
    if (lastSegment(firstArg.childForFieldName('expression')?.text ?? '') !== 'StoreName') return null
    if (firstArg.childForFieldName('name')?.text !== 'Root') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Adding certificate to root store',
      'Opening the Trusted Root Certification Authorities store to add a certificate broadens machine-wide trust in a dangerous way.',
      sourceCode,
      'Do not modify the Root store; trust certificates at the application level (e.g. a custom validation callback) instead.',
    )
  },
}
