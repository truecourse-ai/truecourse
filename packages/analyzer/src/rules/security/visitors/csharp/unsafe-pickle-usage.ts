import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getCallArgs, getCreatedTypeName, lastSegment } from './_helpers.js'

/**
 * C# port of the rule's intent — deserialization that can execute arbitrary
 * code, the .NET equivalent of pickle.loads():
 *   - BinaryFormatter / SoapFormatter / NetDataContractSerializer /
 *     LosFormatter / ObjectStateFormatter (Microsoft: never safe)
 *   - JavaScriptSerializer constructed with a SimpleTypeResolver
 *   - Newtonsoft.Json TypeNameHandling other than None (without a
 *     SerializationBinder restricting types)
 */
const FORBIDDEN_FORMATTERS = new Set([
  'BinaryFormatter', 'SoapFormatter', 'NetDataContractSerializer',
  'LosFormatter', 'ObjectStateFormatter',
])

const UNSAFE_TYPE_NAME_HANDLING = new Set(['All', 'Objects', 'Auto', 'Arrays'])

function siblingInitializerSetsBinder(assign: SyntaxNode): boolean {
  let current = assign.parent
  while (current) {
    if (current.type === 'initializer_expression') {
      return /\bSerializationBinder\b|\bBinder\s*=/.test(current.text)
    }
    if (current.type !== 'assignment_expression') break
    current = current.parent
  }
  return false
}

export const csharpUnsafePickleUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-pickle-usage',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object_creation_expression') {
      const typeName = getCreatedTypeName(node)
      if (FORBIDDEN_FORMATTERS.has(typeName)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'Insecure deserialization',
          `${typeName} deserialization can execute arbitrary code and is forbidden by Microsoft for any data, trusted or not.`,
          sourceCode,
          'Use System.Text.Json or another data-only serializer instead.',
        )
      }
      if (typeName === 'JavaScriptSerializer') {
        const args = getCallArgs(node)
        if (args.some((a) => /\bSimpleTypeResolver\b/.test(a.value.text))) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'Insecure deserialization',
            'JavaScriptSerializer with SimpleTypeResolver instantiates attacker-chosen types during deserialization.',
            sourceCode,
            'Drop the type resolver, or use System.Text.Json with concrete target types.',
          )
        }
      }
      return null
    }

    const target = assignmentTarget(node)
    if (!target || target.name !== 'TypeNameHandling') return null
    if (!/\bTypeNameHandling\s*\./.test(target.value.text)) return null
    if (!UNSAFE_TYPE_NAME_HANDLING.has(lastSegment(target.value.text))) return null
    if (siblingInitializerSetsBinder(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'Insecure deserialization',
      `TypeNameHandling.${lastSegment(target.value.text)} lets JSON payloads choose the CLR types to instantiate — a known RCE vector.`,
      sourceCode,
      'Use TypeNameHandling.None, or restrict types with a custom SerializationBinder.',
    )
  },
}
