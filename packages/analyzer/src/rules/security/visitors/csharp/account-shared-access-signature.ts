import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * `GetSharedAccessSignature` invoked on a storage *account* object
 * (CloudStorageAccount / a `*AccountSasSignatureValues` receiver, or
 * `GetAccountSasUri`). An account SAS grants broad permissions across the whole
 * account that a container-level stored access policy cannot revoke, so a
 * leaked token is hard to contain.
 */
const ACCOUNT_SAS_METHODS = new Set(['GetSharedAccessSignature', 'GetAccountSasUri', 'GetAccountSas'])
const ACCOUNT_RECEIVERS = new Set(['CloudStorageAccount', 'storageAccount', 'account'])

export const csharpAccountSharedAccessSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/account-shared-access-signature',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!ACCOUNT_SAS_METHODS.has(method)) return null
    const receiver = lastSegment(getCSharpReceiver(node))
    // GetAccountSas* names are unambiguously account-level; the generic
    // GetSharedAccessSignature is only account-level on an account receiver.
    if (method === 'GetSharedAccessSignature' && !ACCOUNT_RECEIVERS.has(receiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Account-level shared access signature',
      'An account SAS grants broad, account-wide storage permissions that a container access policy cannot revoke; a leaked token is hard to contain.',
      sourceCode,
      'Issue a service or user-delegation SAS scoped to the specific resource, backed by a stored access policy so it can be revoked.',
    )
  },
}
