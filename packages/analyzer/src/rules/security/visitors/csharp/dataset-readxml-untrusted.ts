import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * `DataSet.ReadXml(...)` — DataSet's XML reader infers a schema from the
 * incoming document and instantiates the encoded types, so crafted XML can
 * drive denial of service or worse when the source is untrusted.
 *
 * Matched on a `DataSet`-typed receiver name (the field/local conventionally
 * `ds`/`dataSet`/`DataSet`) calling `ReadXml`/`ReadXmlSchema`.
 */
const DATASET_RECEIVERS = /(?:^|[._])(?:dataset|ds)$/i
const READXML_METHODS = new Set(['ReadXml', 'ReadXmlSchema'])

export const csharpDataSetReadXmlUntrustedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/dataset-readxml-untrusted',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!READXML_METHODS.has(getCSharpMethodName(node))) return null
    const receiver = lastSegment(getCSharpReceiver(node))
    if (receiver !== 'DataSet' && !DATASET_RECEIVERS.test(receiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'DataSet.ReadXml on untrusted input',
      'DataSet.ReadXml infers a schema and instantiates encoded types from the document, so crafted XML from an untrusted source can cause denial of service or remote code execution.',
      sourceCode,
      'Read into a strongly-typed DataSet with a predefined schema (ReadXmlSchema first) and XmlReadMode.Fragment, or avoid DataSet for untrusted XML.',
    )
  },
}
