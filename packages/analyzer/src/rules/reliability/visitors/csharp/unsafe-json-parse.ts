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

export const csharpUnsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = simpleTypeName(getCSharpReceiver(node))
    const method = getCSharpMethodName(node)
    if (!JSON_PARSERS[receiver]?.has(method)) return null

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
