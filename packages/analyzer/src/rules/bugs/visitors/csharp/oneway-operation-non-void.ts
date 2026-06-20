import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Simple (right-most) name of an attribute's identifier/qualified name. */
function attributeName(attr: SyntaxNode): string {
  const name = attr.childForFieldName('name') ?? attr.namedChildren[0]
  if (!name) return ''
  const text = name.text
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

/** True when an [OperationContract(...)] sets `IsOneWay = true`. */
function isOneWayOperationContract(attr: SyntaxNode): boolean {
  const last = attributeName(attr)
  if (last !== 'OperationContract' && last !== 'OperationContractAttribute') return false
  const args = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
  if (!args) return false
  for (const arg of args.namedChildren) {
    if (arg?.type !== 'attribute_argument') continue
    const id = arg.namedChildren[0]
    const value = arg.namedChildren[1]
    if (id?.text === 'IsOneWay' && value?.type === 'boolean_literal' && value.text === 'true') {
      return true
    }
  }
  return false
}

/**
 * A WCF operation marked `[OperationContract(IsOneWay = true)]` that declares a
 * non-`void`, non-`Task` return type. A one-way operation has no response
 * channel, so a declared return value can never be sent back — the contract is
 * invalid and fails at service load. The return type must be `void` (or `Task`
 * for an async one-way operation).
 */
export const csharpOneWayOperationNonVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/oneway-operation-non-void',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const isOneWay = node.children.some(
      (c) =>
        c?.type === 'attribute_list' &&
        c.namedChildren.some((a) => a?.type === 'attribute' && isOneWayOperationContract(a)),
    )
    if (!isOneWay) return null

    const returnType = node.childForFieldName('returns')
    if (!returnType) return null
    if (returnType.type === 'predefined_type' && returnType.text === 'void') return null

    // Allow Task (the async one-way return) — a Task carries no value back.
    const right = returnType.type === 'qualified_name'
      ? returnType.namedChildren[returnType.namedChildren.length - 1]
      : returnType
    if (right?.text === 'Task') return null

    return makeViolation(
      this.ruleKey, returnType, filePath, 'medium',
      'One-way operation declares a return type',
      `This operation is marked \`IsOneWay = true\` but returns \`${returnType.text}\`. A one-way operation has no response channel, so the return value can never be delivered and the contract is invalid.`,
      sourceCode,
      'Make the operation return `void` (or `Task`), or remove `IsOneWay = true` if a response is expected.',
    )
  },
}
