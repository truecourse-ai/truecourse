import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/** Names of methods declared `virtual` or `abstract` directly on the type. */
function virtualMethodNames(typeDecl: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const body = typeDecl.childForFieldName('body')
  if (!body) return names
  for (const member of body.namedChildren) {
    if (member?.type !== 'method_declaration') continue
    const modifiers = member.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (modifiers.includes('static')) continue
    if (!modifiers.includes('virtual') && !modifiers.includes('abstract')) continue
    const name = member.childForFieldName('name')?.text
    if (name) names.add(name)
  }
  return names
}

/**
 * Collect virtual-method invocations on the instance under construction:
 * a bare `Foo()` call or `this.Foo()` whose target name is virtual/abstract.
 * Calls on other receivers (`other.Foo()`, `base.Foo()`) dispatch on a
 * different object and are not flagged.
 */
function findVirtualSelfCall(node: SyntaxNode, virtuals: Set<string>): { call: SyntaxNode; name: string } | null {
  if (node.type === 'invocation_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'identifier' && virtuals.has(fn.text)) {
      return { call: node, name: fn.text }
    }
    if (
      fn?.type === 'member_access_expression' &&
      fn.childForFieldName('expression')?.type === 'this'
    ) {
      const name = fn.childForFieldName('name')?.text
      if (name && virtuals.has(name)) return { call: node, name }
    }
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findVirtualSelfCall(child, virtuals)
    if (found) return found
  }
  return null
}

/**
 * A constructor that calls a `virtual`/`abstract` method on the instance being
 * constructed. Virtual dispatch resolves to the most-derived override, which
 * runs before that subclass's own constructor has initialized its fields — the
 * override sees half-built state (uninitialized fields, null dependencies).
 *
 * Only calls to methods declared `virtual`/`abstract` on the same type, made
 * with no receiver or a `this` receiver, are flagged; the type itself need not
 * be `sealed`-free reasoning because even a self-call within this type can be
 * overridden in a subclass.
 */
export const csharpVirtualCallInConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/virtual-call-in-constructor',
  languages: ['csharp'],
  nodeTypes: ['constructor_declaration'],
  visit(node, filePath, sourceCode) {
    const isStatic = node.children.some((c) => c?.type === 'modifier' && c.text === 'static')
    if (isStatic) return null

    const typeDecl = node.parent?.parent
    if (
      typeDecl?.type !== 'class_declaration' &&
      typeDecl?.type !== 'record_declaration'
    ) {
      return null
    }
    // A sealed class can still be the base of nothing, but virtual members are
    // illegal on sealed types only when not inherited; the call ordering hazard
    // applies whenever a virtual member exists, so we don't special-case sealed.
    const virtuals = virtualMethodNames(typeDecl)
    if (virtuals.size === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const hit = findVirtualSelfCall(body, virtuals)
    if (!hit) return null

    return makeViolation(
      this.ruleKey, hit.call, filePath, 'medium',
      'Virtual call in constructor',
      `This constructor calls the virtual method \`${hit.name}\`. A derived override runs before that subclass's constructor initializes its fields, so the override sees a half-built object.`,
      sourceCode,
      'Move the call out of the constructor, or make the method non-virtual (or the class sealed) if polymorphism is not needed during construction.',
    )
  },
}
