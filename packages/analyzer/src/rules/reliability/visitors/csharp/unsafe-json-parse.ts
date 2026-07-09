import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { isInsideCSharpTryWithCatch, simpleTypeName } from './_helpers.js'

/** receiver → methods that throw on malformed input. */
const JSON_PARSERS: Record<string, Set<string>> = {
  JsonSerializer: new Set(['Deserialize', 'DeserializeAsync']), // System.Text.Json
  JsonConvert: new Set(['DeserializeObject']), // Newtonsoft.Json
  JsonDocument: new Set(['Parse', 'ParseAsync']),
  JsonNode: new Set(['Parse']),
}

const TYPE_DECLS = new Set([
  'class_declaration', 'struct_declaration', 'record_declaration', 'record_struct_declaration',
])

/** True when `body` directly declares a field or property named `name`. */
function bodyDeclaresMember(body: SyntaxNode, name: string): boolean {
  for (const member of body.namedChildren) {
    if (!member) continue
    if (member.type === 'property_declaration') {
      if (member.childForFieldName('name')?.text === name) return true
    } else if (member.type === 'field_declaration') {
      const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const d of decl?.namedChildren ?? []) {
        if (d?.type === 'variable_declarator' && d.childForFieldName('name')?.text === name) return true
      }
    }
  }
  return false
}

/**
 * True when an enclosing type declares a field/property named `name`. Such a
 * member shadows a same-named BCL type in a `name.Member(...)` access — the
 * receiver is the instance member, not the type.
 */
function enclosingTypeDeclaresMember(node: SyntaxNode, name: string): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (TYPE_DECLS.has(current.type)) {
      const body = current.childForFieldName('body')
      if (body && bodyDeclaresMember(body, name)) return true
    }
    current = current.parent
  }
  return false
}

export const csharpUnsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const rawReceiver = getCSharpReceiver(node)
    const receiver = simpleTypeName(rawReceiver)
    const method = getCSharpMethodName(node)
    if (!JSON_PARSERS[receiver]?.has(method)) return null

    // Receiver name-collision guard. Code that injects a member named after the
    // BCL entry point — e.g. abp's `protected IJsonSerializer JsonSerializer { get; }`
    // called as `JsonSerializer.Deserialize<T>(...)` — is invoking that instance
    // member, not the same-named static BCL type, so it is not a BCL JSON parse.
    // A bare `Name` (or `this.Name`) that an enclosing type declares as a
    // field/property resolves to the member; a namespace-qualified receiver
    // (`System.Text.Json.JsonSerializer`, other dots) still fires.
    const bareReceiver = rawReceiver.startsWith('this.') ? rawReceiver.slice(5) : rawReceiver
    if (!bareReceiver.includes('.') && enclosingTypeDeclaresMember(node, bareReceiver)) return null

    // `JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(x))` is the
    // deep-clone idiom — the input was just produced by the serializer and is
    // guaranteed valid, so no try/catch is needed.
    const firstArg = getCSharpArguments(node)[0]
    if (firstArg?.type === 'invocation_expression') {
      const innerReceiver = simpleTypeName(getCSharpReceiver(firstArg))
      const innerMethod = getCSharpMethodName(firstArg)
      if (
        (innerReceiver === 'JsonSerializer' && innerMethod === 'Serialize') ||
        (innerReceiver === 'JsonConvert' && innerMethod === 'SerializeObject')
      ) return null
    }

    if (isInsideCSharpTryWithCatch(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe JSON deserialization',
      `${receiver}.${method}() throws JsonException on malformed input. Wrap it in a try/catch.`,
      sourceCode,
      `Wrap ${receiver}.${method}() in a try/catch (catch (JsonException ex)) to handle malformed JSON gracefully.`,
    )
  },
}
