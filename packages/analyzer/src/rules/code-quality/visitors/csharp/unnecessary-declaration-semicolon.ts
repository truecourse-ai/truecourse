import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type body closes with `}`; a trailing `;` after it (`class C { … };`) is a
 * C/C++ habit that compiles but is pure punctuation — usually a copy-paste
 * slip or a leftover from a refactor (RCS1055). Detected by a declaration node
 * whose source extends past its body's closing `}` with a `;`. The body list
 * (`declaration_list` / `enum_member_declaration_list`) is the last *named*
 * child; the trailing `;` is absorbed as an extra token, lengthening the
 * declaration node beyond its body.
 */
const BODY_LIST_TYPES = new Set(['declaration_list', 'enum_member_declaration_list'])

export const csharpUnnecessaryDeclarationSemicolonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-declaration-semicolon',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
  visit(node, filePath, sourceCode) {
    const body = lastBodyList(node)
    if (!body) return null

    // The declaration node text past the body's closing brace.
    const tail = sourceCode.slice(body.endIndex, node.endIndex)
    if (!tail.includes(';')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary semicolon after declaration',
      'A `;` follows the type body — it is superfluous punctuation (a C/C++ habit) that signals a copy-paste slip or refactor leftover (RCS1055).',
      sourceCode,
      'Remove the trailing semicolon after the type body.',
    )
  },
}

function lastBodyList(node: SyntaxNode): SyntaxNode | null {
  for (let i = node.namedChildCount - 1; i >= 0; i--) {
    const child = node.namedChild(i)
    if (child && BODY_LIST_TYPES.has(child.type)) return child
  }
  return null
}
