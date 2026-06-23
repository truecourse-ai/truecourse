import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TYPE_DECL_TYPES = new Set([
  'class_declaration', 'struct_declaration', 'interface_declaration',
  'record_declaration', 'enum_declaration', 'delegate_declaration',
])

/**
 * A file whose name matches none of its top-level types. The file is well-named if
 * ANY top-level type matches the file name, so a file holding `IOrderRepository` +
 * `OrderRepository` named OrderRepository.cs is correct. Generic-file conventions
 * (`Cache{TKey}.cs`, `Cache.TKey.cs`, partial-of `Foo.Bar.cs`) are accepted.
 */
export const csharpFilenameTypeMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/csharp-filename-type-mismatch',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const base = filePath.split('/').pop() ?? ''
    const fileName = base.replace(/\.[^.]*$/, '')
    if (!fileName) return null

    const identifiers = topLevelTypeIdentifiers(node)
    if (identifiers.length === 0) return null
    if (identifiers.some((id) => nameMatches(fileName, id.text))) return null

    const first = identifiers[0]
    return makeViolation(
      this.ruleKey, first, filePath, 'low',
      'File name does not match a contained type',
      `File '${fileName}' declares type '${first.text}' but no top-level type matches the file name; name the file after a type so it is easy to locate.`,
      sourceCode,
      `Rename the file after a contained type, e.g. ${first.text}.cs.`,
    )
  },
}

/** Identifiers of every top-level type/delegate declaration, descending into namespaces. */
function topLevelTypeIdentifiers(root: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  const collectFrom = (container: SyntaxNode) => {
    for (let i = 0; i < container.namedChildCount; i++) {
      const m = container.namedChild(i)
      if (!m) continue
      if (m.type === 'namespace_declaration') {
        const body = m.namedChildren.find((c) => c?.type === 'declaration_list')
        if (body) collectFrom(body)
      } else if (TYPE_DECL_TYPES.has(m.type)) {
        const id = m.childForFieldName('name')
        if (id) out.push(id)
      }
      // file_scoped_namespace_declaration carries no body; its types are siblings
      // in the compilation_unit and are visited by this same loop.
    }
  }
  collectFrom(root)
  return out
}

function nameMatches(fileName: string, typeName: string): boolean {
  if (fileName === typeName) return true
  const brace = fileName.indexOf('{')
  if (brace > 0 && fileName.slice(0, brace) === typeName) return true
  const dot = fileName.indexOf('.')
  if (dot > 0 && fileName.slice(0, dot) === typeName) return true
  return false
}
