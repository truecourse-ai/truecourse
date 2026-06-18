import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { isCSharpGeneratedSource } from './_helpers.js'

const TYPE_DECLARATIONS = new Set([
  'class_declaration', 'interface_declaration', 'struct_declaration',
  'record_declaration', 'enum_declaration', 'delegate_declaration',
])

/** Collect namespace-level type declarations (file-scoped and block namespaces). */
function collectTopLevelTypes(root: SyntaxNode, acc: SyntaxNode[]): void {
  for (const child of root.namedChildren) {
    if (!child) continue
    if (TYPE_DECLARATIONS.has(child.type)) {
      acc.push(child)
    } else if (child.type === 'namespace_declaration') {
      const body = child.childForFieldName('body')
      if (body) collectTopLevelTypes(body, acc)
    } else if (child.type === 'declaration_list' || child.type === 'compilation_unit') {
      collectTopLevelTypes(child, acc)
    }
    // file_scoped_namespace_declaration: the types are SIBLINGS, already
    // visited by this loop.
  }
}

/**
 * The C# one-type-per-file convention: a file containing a single public
 * top-level type is named after that type. Partial classes (whose files are
 * conventionally `Type.Aspect.cs`) and generated files are skipped.
 */
export const csharpFilenameClassMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/filename-class-mismatch',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null

    const fileBase = filePath.split('/').pop()?.replace(/\.cs$/i, '') ?? ''
    if (!fileBase) return null
    // Dotted file names (`OrderService.Validation.cs`) encode an aspect of a
    // partial type, not a type name.
    if (fileBase.includes('.')) return null

    const types: SyntaxNode[] = []
    collectTopLevelTypes(node, types)

    const publicTypes = types.filter((t) => hasCSharpModifier(t, 'public'))
    if (publicTypes.length !== 1) return null

    const type = publicTypes[0]!
    if (hasCSharpModifier(type, 'partial')) return null

    const name = type.childForFieldName('name')?.text
    if (!name || name === fileBase) return null

    return makeViolation(
      this.ruleKey, type, filePath, 'low',
      'Filename/type name mismatch',
      `Public type \`${name}\` does not match the file name \`${fileBase}.cs\`. One public type per file, named after the file, keeps navigation predictable.`,
      sourceCode,
      `Rename the file to \`${name}.cs\`, or rename the type to \`${fileBase}\`.`,
    )
  },
}
