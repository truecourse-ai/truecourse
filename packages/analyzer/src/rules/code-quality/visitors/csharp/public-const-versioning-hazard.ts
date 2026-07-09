import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * A `public const` value is inlined into consuming assemblies at compile time,
 * so changing it does not take effect until every consumer recompiles —
 * a silent versioning hazard. `static readonly` is read at runtime and updates
 * for consumers on assembly swap. The check fires on a `public` (or
 * `protected`) `const` `field_declaration` on a type. Private/internal consts
 * never cross an assembly boundary and are left alone.
 */

/** The declared names of a `const` field (`public const string A = "x", B = "y";`). */
function constFieldNames(fieldDecl: SyntaxNode): string[] {
  const names: string[] = []
  const varDecl = fieldDecl.namedChildren.find((c) => c?.type === 'variable_declaration')
  if (!varDecl) return names
  for (const vd of varDecl.namedChildren) {
    if (vd?.type !== 'variable_declarator') continue
    const n = vd.childForFieldName('name')?.text ?? vd.namedChildren.find((c) => c?.type === 'identifier')?.text
    if (n) names.push(n)
  }
  return names
}

/**
 * True when one of `names` is used inside another `const` field's initializer
 * anywhere in the file. Such a constant is composed into a further compile-time
 * constant, so it MUST stay `const` — a `static readonly` field is not a
 * constant expression and would not compile in that position. Flagging it is a
 * false positive.
 */
function referencedBySiblingConst(node: SyntaxNode, names: string[]): boolean {
  let root: SyntaxNode = node
  while (root.parent) root = root.parent

  let found = false
  const scan = (n: SyntaxNode): void => {
    if (found) return
    if (n.type === 'field_declaration' && n.id !== node.id && hasCSharpModifier(n, 'const')) {
      const varDecl = n.namedChildren.find((c) => c?.type === 'variable_declaration')
      if (varDecl) {
        for (const vd of varDecl.namedChildren) {
          if (vd?.type !== 'variable_declarator') continue
          // Walk only the initializer value, not the declared name, for a name hit.
          const declaredName = vd.childForFieldName('name')
          walkCSharp(vd, (id) => {
            if (id.type === 'identifier' && id.id !== declaredName?.id && names.includes(id.text)) {
              found = true
            }
          })
        }
      }
    }
    for (const c of n.namedChildren) if (c) scan(c)
  }
  scan(root)
  return found
}

export const csharpPublicConstVersioningHazardVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/public-const-versioning-hazard',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'const')) return null
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null

    // A constant composed into another constant must remain `const`.
    const names = constFieldNames(node)
    if (names.length > 0 && referencedBySiblingConst(node, names)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Public constant versioning hazard',
      'A `public const` value is inlined into consumers at compile time and will not update unless they recompile — prefer `static readonly`.',
      sourceCode,
      'Replace the `public const` with a `public static readonly` field.',
    )
  },
}
