import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * An Azure Function host scales out and recycles instances freely, so static
 * mutable fields are not a reliable place to keep state across invocations:
 * two invocations may hit different instances, or the same field may be reset.
 * Flag the Function method on a class that also holds mutable static
 * (non-readonly, non-const) fields.
 *
 * Reported on the `[FunctionName]`/`[Function]` method — the function itself —
 * rather than the field: the general "mutable process-global state" angle on
 * the field is already owned by declarations-in-global-scope, so pointing here
 * keeps the two signals distinct and complementary.
 */
function functionMethod(classDecl: SyntaxNode): SyntaxNode | null {
  const body = classDecl.childForFieldName('body')
  if (!body) return null
  for (const member of body.namedChildren) {
    if (member?.type !== 'method_declaration') continue
    const attrs = getCSharpAttributeNames(member)
    if (attrs.includes('FunctionName') || attrs.includes('Function')) return member
  }
  return null
}

function mutableStaticField(classDecl: SyntaxNode): SyntaxNode | null {
  const body = classDecl.childForFieldName('body')
  if (!body) return null
  for (const member of body.namedChildren) {
    if (member?.type !== 'field_declaration') continue
    if (!hasCSharpModifier(member, 'static')) continue
    if (hasCSharpModifier(member, 'readonly') || hasCSharpModifier(member, 'const')) continue
    return member
  }
  return null
}

export const csharpAzureFunctionStatefulVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/azure-function-stateful',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const method = functionMethod(node)
    if (!method) return null
    if (!mutableStaticField(node)) return null

    const fnName = method.childForFieldName('name')?.text ?? 'function'
    return makeViolation(
      this.ruleKey, method, filePath, 'low',
      'Stateful Azure Function',
      `Azure Function '${fnName}' relies on mutable static state, which the elastic host cannot preserve across invocations.`,
      sourceCode,
      'Persist cross-invocation state in durable storage (Table/Blob/Cosmos) or a Durable Function, not a static field.',
    )
  },
}
