import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getCallArgs, getCreatedTypeName, getInitializerAssignments, lastSegment } from './_helpers.js'

/**
 * XSLT processed with script execution or the document() function enabled:
 *   - `new XsltSettings(enableDocumentFunction: true, enableScript: true)`
 *   - an initializer/assignment turning on `EnableScript` / `EnableDocumentFunction`
 *   - the static `XsltSettings.TrustedXslt` (both flags on)
 * Any of these lets an untrusted stylesheet run embedded code or read files.
 */
const DANGEROUS_FLAGS = new Set(['EnableScript', 'EnableDocumentFunction'])

function isTrue(node: import('web-tree-sitter').Node | undefined): boolean {
  return node?.type === 'boolean_literal' && node.text === 'true'
}

export const csharpInsecureXsltScriptVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-xslt-script',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'assignment_expression', 'member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'member_access_expression') {
      // XsltSettings.TrustedXslt — both flags enabled.
      if (lastSegment(node.childForFieldName('expression')?.text ?? '') !== 'XsltSettings') return null
      if (node.childForFieldName('name')?.text !== 'TrustedXslt') return null
    } else if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || !DANGEROUS_FLAGS.has(target.name) || !isTrue(target.value)) return null
    } else {
      if (getCreatedTypeName(node) !== 'XsltSettings') return null
      const args = getCallArgs(node)
      // ctor(enableDocumentFunction, enableScript): either flag true is unsafe.
      const positionalTrue = args.some((a) => a.name === null && isTrue(a.value))
      const namedTrue = args.some((a) => a.name !== null && isTrue(a.value))
      if (!positionalTrue && !namedTrue) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Insecure XSLT script execution',
      'Enabling script execution or the document() function in XSLT lets an untrusted stylesheet run embedded code or disclose data.',
      sourceCode,
      'Process untrusted XSLT with XsltSettings.Default (both flags off) and a restricted XmlResolver.',
    )
  },
}
