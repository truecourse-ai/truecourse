import type { Node as SyntaxNode } from 'web-tree-sitter'

/** The simple (last-segment) name of an `attribute` node: `[System.Foo]` → 'Foo'. */
export function csharpAttributeSimpleName(attr: SyntaxNode): string {
  const name = attr.childForFieldName('name')?.text ?? ''
  return name.split('<')[0].split('.').pop() ?? name
}

/** Iterate every `attribute` node across all of a declaration's `attribute_list`s. */
export function csharpAttributes(decl: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (const child of decl.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type === 'attribute') out.push(attr)
    }
  }
  return out
}

/** The first `attribute` on `decl` matching one of `names` (by simple name), or null. */
export function csharpFindAttribute(decl: SyntaxNode, names: ReadonlySet<string>): SyntaxNode | null {
  for (const attr of csharpAttributes(decl)) {
    if (names.has(csharpAttributeSimpleName(attr))) return attr
  }
  return null
}

/** True when an attribute carries a named argument `name = …` (e.g. `Justification = "x"`). */
export function csharpAttributeHasNamedArg(attr: SyntaxNode, argName: string): boolean {
  const argList = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
  if (!argList) return false
  for (const arg of argList.namedChildren) {
    if (arg?.type !== 'attribute_argument') continue
    // A named argument is `name = expression`; tree-sitter exposes the LHS as
    // the `name` field. Require a non-empty value so `Justification = ""`
    // (an empty justification) does not count as supplied.
    const name = arg.childForFieldName('name')
    if (name?.text !== argName) continue
    const value = arg.namedChildren.find((c) => c && c.id !== name.id)
    if (!value) continue
    const text = value.text.trim()
    if (text === '""' || text === 'null' || text === 'string.Empty') continue
    return true
  }
  return false
}
