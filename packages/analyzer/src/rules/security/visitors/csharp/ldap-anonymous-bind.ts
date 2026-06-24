import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getCallArgs, getCreatedTypeName, getInitializerAssignments, lastSegment } from './_helpers.js'

/**
 * A `DirectoryEntry` configured for anonymous LDAP authentication:
 * `AuthenticationTypes.Anonymous` passed to the constructor, set via an object
 * initializer, or assigned to `.AuthenticationType`. Anonymous bind allows
 * unauthenticated directory access.
 */
function isAnonymous(value: import('web-tree-sitter').Node | undefined): boolean {
  if (!value || value.type !== 'member_access_expression') return false
  if (lastSegment(value.childForFieldName('expression')?.text ?? '') !== 'AuthenticationTypes') return false
  return value.childForFieldName('name')?.text === 'Anonymous'
}

export const csharpLdapAnonymousBindVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ldap-anonymous-bind',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || target.name !== 'AuthenticationType') return null
      if (!isAnonymous(target.value)) return null
    } else {
      if (getCreatedTypeName(node) !== 'DirectoryEntry') return null
      const fromArgs = getCallArgs(node).some((a) => isAnonymous(a.value))
      const fromInit = getInitializerAssignments(node).some((a) => a.name === 'AuthenticationType' && isAnonymous(a.value))
      if (!fromArgs && !fromInit) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Anonymous LDAP bind',
      'Configuring AuthenticationTypes.Anonymous on a DirectoryEntry allows unauthenticated directory access.',
      sourceCode,
      'Bind with explicit credentials and AuthenticationTypes.Secure (or stronger).',
    )
  },
}
