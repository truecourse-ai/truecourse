import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
// Assembly version: 1–4 dotted components, each a number or a `*` wildcard.
const VERSION_RE = /^\d+(\.(\d+|\*)){0,3}$/

const GUID_ATTRS = new Set(['Guid', 'GuidAttribute'])
const VERSION_ATTRS = new Set([
  'AssemblyVersion', 'AssemblyVersionAttribute',
  'AssemblyFileVersion', 'AssemblyFileVersionAttribute',
])

/**
 * A string literal passed to an attribute that requires a specific format —
 * <c>[Guid("…")]</c> or <c>[AssemblyVersion("…")]</c> — that does not parse as one.
 * These are validated by the runtime/compiler only late (or silently accepted and
 * misinterpreted), so a typo'd GUID or version slips through to a confusing failure.
 * Scoped to attributes whose argument format is unambiguous, so a literal that
 * simply isn't one of these never trips it.
 */
export const csharpAttributeStringLiteralParseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/attribute-string-literal-parse',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = (node.childForFieldName('name')?.text ?? '').split('.').pop() ?? ''
    const kind = GUID_ATTRS.has(name) ? 'GUID' : VERSION_ATTRS.has(name) ? 'version' : null
    if (kind === null) return null

    const lit = firstStringLiteral(node)
    if (!lit) return null
    const content = lit.text.replace(/^@?"/, '').replace(/"$/, '')

    const ok = kind === 'GUID' ? GUID_RE.test(content) : VERSION_RE.test(content)
    if (ok) return null

    return makeViolation(
      this.ruleKey, lit, filePath, 'medium',
      `Attribute string is not a valid ${kind}`,
      `The ${name} attribute argument "${content}" is not a valid ${kind}.`,
      sourceCode,
      `Provide a valid ${kind} for the ${name} attribute.`,
    )
  },
}

function firstStringLiteral(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'string_literal' || node.type === 'verbatim_string_literal') return node
  for (let i = 0; i < node.namedChildCount; i++) {
    const found = firstStringLiteral(node.namedChild(i)!)
    if (found) return found
  }
  return null
}
