import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { lastSegment } from './_helpers.js'

/**
 * `DataTable.ReadXml(...)` — the same untrusted-XML hazard as DataSet.ReadXml
 * at table granularity: the reader infers a schema and materializes encoded
 * types from the document.
 *
 * Matched on a `DataTable`-typed receiver name (conventionally `dt`/`table`/
 * `dataTable`) calling `ReadXml`/`ReadXmlSchema`.
 */
const DATATABLE_RECEIVERS = /(?:^|[._])(?:datatable|dt|table)$/i
const READXML_METHODS = new Set(['ReadXml', 'ReadXmlSchema'])

export const csharpDataTableReadXmlUntrustedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/datatable-readxml-untrusted',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!READXML_METHODS.has(getCSharpMethodName(node))) return null
    const receiver = lastSegment(getCSharpReceiver(node))
    if (receiver !== 'DataTable' && !DATATABLE_RECEIVERS.test(receiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'DataTable.ReadXml on untrusted input',
      'DataTable.ReadXml infers a schema and materializes encoded types from the document, so crafted XML from an untrusted source can cause denial of service or worse.',
      sourceCode,
      'Read into a table with a predefined schema (ReadXmlSchema first) and XmlReadMode.Fragment, or avoid DataTable for untrusted XML.',
    )
  },
}
