import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Long-lived SDK clients that own a connection pool and are meant to be reused.
const CLIENT_TYPES = new Set([
  'HttpClient', 'CosmosClient', 'DocumentClient', 'ServiceBusClient', 'BlobServiceClient',
  'QueueServiceClient', 'TableServiceClient', 'EventHubProducerClient', 'EventHubConsumerClient',
  'SqlConnection', 'ServiceBusSender',
])
const FUNCTION_ATTRS = new Set(['Function', 'FunctionName'])

/**
 * A connection-owning SDK client (<c>HttpClient</c>, <c>CosmosClient</c>, …) constructed
 * inside an Azure Function method. Functions are invoked on a hot path and the host keeps
 * the class alive across invocations, so a client built per call leaks sockets and
 * exhausts the connection pool under load (SNAT port exhaustion). These clients are meant
 * to be created once and reused via a static field or DI. Detected structurally — a
 * client construction inside a method carrying <c>[Function]</c>/<c>[FunctionName]</c> —
 * so no reference assemblies are needed.
 */
export const csharpAzureFunctionClientRecreatedVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/azure-function-client-recreated',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = createdTypeName(node)
    if (!CLIENT_TYPES.has(typeName)) return null

    const method = enclosingMethod(node)
    if (!method) return null
    if (!attributeNames(method).some((a) => FUNCTION_ATTRS.has(a))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Client recreated per Azure Function invocation',
      `A new ${typeName} is constructed inside an Azure Function; per-invocation creation leaks sockets and exhausts the connection pool under load.`,
      sourceCode,
      `Create ${typeName} once in a static field or inject it, and reuse it across invocations.`,
    )
  },
}

/** Simple type name of a `new Foo.Bar<T>(…)` creation. */
function createdTypeName(creation: SyntaxNode): string {
  const type = creation.childForFieldName('type') ?? creation.namedChildren[0]
  if (!type) return ''
  if (type.type === 'identifier') return type.text
  if (type.type === 'generic_name') return type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  if (type.type === 'qualified_name') {
    const last = type.namedChildren[type.namedChildren.length - 1]
    return last?.type === 'generic_name'
      ? (last.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (last?.text ?? '')
  }
  return type.text
}

function enclosingMethod(node: SyntaxNode): SyntaxNode | null {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === 'method_declaration') return cur
    if (cur.type === 'class_declaration') return null
  }
  return null
}

function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
