import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Reserved exception types that callers cannot meaningfully distinguish, so
 * throwing them directly is discouraged. NullReferenceException, IndexOutOfRange
 * and AccessViolation are runtime-reserved; the general base types give callers
 * nothing specific to catch.
 */
const RESERVED = new Set([
  'Exception',
  'SystemException',
  'ApplicationException',
  'NullReferenceException',
  'IndexOutOfRangeException',
  'ExecutionEngineException',
  'OutOfMemoryException',
  'StackOverflowException',
])

/** Last dotted segment of a (possibly `System.`-qualified) type name. */
function lastSegment(name: string): string {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
}

/**
 * `throw new Exception(...)` (or another reserved/general exception type). The
 * caller has no specific type to catch — they must catch the broad base type and
 * risk swallowing unrelated failures. A purpose-specific exception type (or a
 * standard one like ArgumentException/InvalidOperationException) should be used.
 *
 * Only the `throw new <ReservedType>(…)` form is reported; re-throwing a caught
 * exception or throwing a constructed variable is not matched.
 */
export const csharpRaiseReservedExceptionTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-reserved-exception-type',
  languages: ['csharp'],
  nodeTypes: ['throw_statement', 'throw_expression'],
  visit(node, filePath, sourceCode) {
    const creation = node.namedChildren.find((c) => c?.type === 'object_creation_expression')
    if (!creation) return null

    const typeName = creation.childForFieldName('type')?.text
    if (!typeName) return null
    if (!RESERVED.has(lastSegment(typeName))) return null

    return makeViolation(
      this.ruleKey, creation, filePath, 'medium',
      'Throwing a reserved exception type',
      `Throwing \`${lastSegment(typeName)}\` gives callers no specific type to catch; use a purpose-specific or standard exception type instead.`,
      sourceCode,
      'Throw a more specific exception type (e.g. ArgumentException, InvalidOperationException, or a custom exception).',
    )
  },
}
