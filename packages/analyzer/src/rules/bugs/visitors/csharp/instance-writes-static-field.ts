import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, unwrapParens } from './_helpers.js'

/** Names of `static` (non-const) fields declared directly on the type. */
function staticFieldNames(typeDecl: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const body = typeDecl.childForFieldName('body')
  if (!body) return names
  for (const member of body.namedChildren) {
    if (member?.type !== 'field_declaration') continue
    const isStatic = member.children.some((c) => c?.type === 'modifier' && c.text === 'static')
    const isConst = member.children.some((c) => c?.type === 'modifier' && c.text === 'const')
    if (!isStatic || isConst) continue
    const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
    for (const d of decl?.namedChildren ?? []) {
      if (d?.type === 'variable_declarator') {
        const n = d.childForFieldName('name')?.text
        if (n) names.add(n)
      }
    }
  }
  return names
}

/** Simple assigned-name of an assignment target, when it is a bare/this field. */
function assignedFieldName(left: SyntaxNode): string | null {
  const target = unwrapParens(left)
  if (target.type === 'identifier') return target.text
  if (
    target.type === 'member_access_expression' &&
    target.childForFieldName('expression')?.type === 'this'
  ) {
    return target.childForFieldName('name')?.text ?? null
  }
  return null
}

/** Collect assignment targets within the method body, not crossing nested functions. */
function collectAssignments(node: SyntaxNode, out: SyntaxNode[]): void {
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left')
    if (left) out.push(left)
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child) continue
    if (CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    collectAssignments(child, out)
  }
}

/**
 * An instance method that writes to a `static` field of its own type. Mutating
 * shared static state from a per-instance method is an unexpected hidden
 * coupling and a thread-safety hazard — every instance silently affects all
 * others through the shared field.
 *
 * Scoped to plain instance `method_declaration`s (constructors are covered by a
 * separate rule) writing a field this type itself declares as static. A
 * qualified write through another object (`other.X`) is not matched.
 */
export const csharpInstanceWritesStaticFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/instance-writes-static-field',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const isStatic = node.children.some((c) => c?.type === 'modifier' && c.text === 'static')
    if (isStatic) return null

    const typeDecl = node.parent?.parent
    if (
      typeDecl?.type !== 'class_declaration' &&
      typeDecl?.type !== 'struct_declaration' &&
      typeDecl?.type !== 'record_declaration'
    ) {
      return null
    }
    const statics = staticFieldNames(typeDecl)
    if (statics.size === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const targets: SyntaxNode[] = []
    collectAssignments(body, targets)
    for (const left of targets) {
      const name = assignedFieldName(left)
      if (name && statics.has(name)) {
        return makeViolation(
          this.ruleKey, left, filePath, 'medium',
          'Instance method writes a static field',
          `This instance method assigns the static field \`${name}\`, mutating shared state that every instance sees — an unexpected coupling and thread-safety hazard.`,
          sourceCode,
          'Move the static-field write into a static method, or use instance state instead.',
        )
      }
    }
    return null
  },
}
