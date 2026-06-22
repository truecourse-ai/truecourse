import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCreatedTypeName } from './_helpers.js'

/**
 * `new XslTransform()` — the obsolete System.Xml.Xsl transform that always
 * enables embedded-script execution and document() resolution, so an untrusted
 * stylesheet can disclose data or run code. XslCompiledTransform (with scripts
 * disabled) is the supported replacement.
 */
export const csharpUseOfXslTransformVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/use-of-xsltransform',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCreatedTypeName(node) !== 'XslTransform') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Use of obsolete XslTransform',
      'XslTransform is obsolete and executes embedded scripts and document() references, which is unsafe for untrusted stylesheets.',
      sourceCode,
      'Use XslCompiledTransform with XsltSettings.Default (scripts and document() disabled).',
    )
  },
}
