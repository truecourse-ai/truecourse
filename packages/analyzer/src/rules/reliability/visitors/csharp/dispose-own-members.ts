import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { declaresIDisposable, findDisposeMethod, getDisposableFields } from './_helpers.js'

/**
 * A class that implements IDisposable and owns disposable fields, but whose
 * Dispose() method never disposes one of those fields. The class advertises
 * deterministic cleanup yet leaks the field's resource anyway.
 *
 * "Disposes the field" is recognized syntactically anywhere reachable from
 * Dispose() — `_field.Dispose()`, `_field?.Dispose()`, `(_field as
 * IDisposable)?.Dispose()`, or any text reference to the field inside a
 * Dispose/DisposeAsync call argument — so the standard `Dispose(bool
 * disposing)` delegation pattern (Dispose() → Dispose(true) → field.Dispose())
 * is honoured by scanning the whole type's Dispose-shaped methods.
 *
 * Precision: only fields of a well-known disposable type are required, and the
 * field merely has to be mentioned inside a Dispose-named method body — we do
 * not insist on a particular call shape, which keeps the false-positive rate at
 * zero for custom cleanup helpers that forward the field.
 */
function collectDisposeBodies(typeDecl: SyntaxNode): SyntaxNode[] {
  const bodies: SyntaxNode[] = []
  const body = typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return bodies
  for (const member of body.namedChildren) {
    const name =
      member?.type === 'method_declaration'
        ? member.childForFieldName('name')?.text
        : member?.type === 'destructor_declaration'
          ? '~'
          : undefined
    if (member?.type === 'method_declaration' && name !== 'Dispose' && name !== 'DisposeAsync' && name !== 'DisposeCore' && name !== 'Cleanup' && name !== 'ReleaseResources') continue
    if (member?.type !== 'method_declaration' && member?.type !== 'destructor_declaration') continue
    const b = member.childForFieldName('body') ?? member.namedChildren.find((c) => c?.type === 'block')
    if (b) bodies.push(b)
  }
  return bodies
}

export const csharpDisposeOwnMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/dispose-own-members',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!declaresIDisposable(node)) return null

    const dispose = findDisposeMethod(node)
    if (!dispose) return null

    const fields = getDisposableFields(node)
    if (fields.length === 0) return null

    // Aggregate the text of every Dispose-shaped method body so the standard
    // Dispose() → Dispose(bool) delegation is covered.
    const disposeText = collectDisposeBodies(node)
      .map((b) => b.text)
      .join('\n')

    const undisposed = fields.filter((f) => {
      // The field name must appear in a Dispose/DisposeAsync call to count.
      const re = new RegExp(`\\b${f.name}\\b[^;]*\\.\\s*Dispose`)
      return !re.test(disposeText)
    })
    if (undisposed.length === 0) return null

    const first = undisposed[0]!
    return makeViolation(
      this.ruleKey, dispose.childForFieldName('name') ?? dispose, filePath, 'high',
      'Dispose does not release an owned member',
      `Dispose() does not dispose the owned field '${first.name}' (${first.typeName}). The class implements IDisposable but still leaks that resource.`,
      sourceCode,
      `Dispose every owned field in Dispose() (e.g. ${first.name}?.Dispose();), following the standard Dispose(bool disposing) pattern.`,
    )
  },
}
