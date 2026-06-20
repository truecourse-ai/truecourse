import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * `XmlSchemaSet.Add(...)` / `XmlSchemaCollection.Add(...)` given a URL — a
 * string-literal `schemaUri` ending in `.xsd` or starting with a `http(s)`/
 * `file`/`ftp` scheme. Adding a schema by URL makes the parser resolve and
 * fetch an external resource, which can pull in dangerous external references.
 *
 * Scoped to a schema-collection receiver and a URL-shaped literal to stay
 * precise; an in-memory XmlReader/Stream overload of Add is the safe pattern.
 */
const SCHEMA_RECEIVERS = /(?:^|[._])(?:schemas?|schemaset|xmlschemaset|xmlschemacollection)$/i
const URL_LITERAL = /^(?:https?|ftp|file):\/\/|\.xsd$/i

export const csharpXmlSchemaAddByUrlVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/xmlschema-add-by-url',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Add') return null
    const receiver = lastSegment(getCSharpReceiver(node))
    if (!SCHEMA_RECEIVERS.test(receiver) && receiver !== 'XmlSchemaSet' && receiver !== 'XmlSchemaCollection') return null

    const hasUrlArg = getCallArgs(node).some(
      (a) => isPlainStringLiteral(a.value) && URL_LITERAL.test(staticStringText(a.value).trim()),
    )
    if (!hasUrlArg) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'XML schema added by URL',
      'Adding a schema by URL makes the XML parser resolve and fetch an external resource, which can pull in dangerous external references.',
      sourceCode,
      'Load the schema from a trusted local stream/XmlReader with a restricted XmlResolver instead of a URL.',
    )
  },
}
