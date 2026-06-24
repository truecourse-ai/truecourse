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

/** Collect assignment targets within the body, not crossing nested functions. */
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
 * An instance constructor that assigns a `static` field of its own type. Every
 * `new` then silently overwrites shared state — a counter reset, a cached
 * singleton clobbered, configuration re-stamped — coupling all instances
 * through the static field. Such initialization belongs in a static constructor
 * or static initializer, which runs exactly once.
 *
 * A `static` constructor (the legitimate place) declares the `static` modifier
 * and is skipped.
 */
export const csharpStaticFieldSetInConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/static-field-set-in-constructor',
  languages: ['csharp'],
  nodeTypes: ['constructor_declaration'],
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
          'Static field set in constructor',
          `This constructor assigns the static field \`${name}\`, so every new instance silently overwrites shared state.`,
          sourceCode,
          'Initialize the static field in a static constructor or static initializer, which runs once.',
        )
      }
    }
    return null
  },
}
