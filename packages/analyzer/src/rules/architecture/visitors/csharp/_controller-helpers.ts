import type { Node as SyntaxNode } from 'web-tree-sitter'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/** HTTP-verb attributes that declare which verbs a controller action handles. */
export const HTTP_VERB_ATTRIBUTES = new Set([
  'HttpGet', 'HttpPost', 'HttpPut', 'HttpDelete', 'HttpPatch', 'HttpHead', 'HttpOptions',
])

/** Names that signal a type is an ASP.NET MVC/Web-API controller. */
const CONTROLLER_BASE_NAMES = new Set(['Controller', 'ControllerBase'])

/**
 * Whether a class declaration is a controller: either decorated with
 * `[ApiController]`/`[Controller]`, derives from a *Controller base type, or
 * its name ends in `Controller`. Conservative — we only treat a type as a
 * controller when at least one structural signal is present.
 */
export function isControllerClass(classDecl: SyntaxNode): boolean {
  const attrs = getCSharpAttributeNames(classDecl)
  if (attrs.includes('ApiController') || attrs.includes('Controller')) return true

  const name = classDecl.childForFieldName('name')?.text ?? ''
  if (name.endsWith('Controller')) return true

  const baseList = classDecl.namedChildren.find((c) => c?.type === 'base_list')
  if (baseList) {
    for (const base of baseList.namedChildren) {
      if (!base) continue
      const baseName = base.type === 'generic_name'
        ? base.namedChildren.find((c) => c?.type === 'identifier')?.text ?? base.text
        : base.text
      const simple = baseName.split('.').pop() ?? baseName
      if (CONTROLLER_BASE_NAMES.has(simple) || simple.endsWith('Controller')) return true
    }
  }
  return false
}

/**
 * Public, non-static methods of a controller that ASP.NET treats as actions.
 * Excludes constructors, accessors and methods marked `[NonAction]`.
 */
export function getControllerActions(classDecl: SyntaxNode): SyntaxNode[] {
  const body = classDecl.childForFieldName('body')
  if (!body) return []
  const actions: SyntaxNode[] = []
  for (const member of body.namedChildren) {
    if (member?.type !== 'method_declaration') continue
    if (!hasCSharpModifier(member, 'public')) continue
    if (hasCSharpModifier(member, 'static')) continue
    if (getCSharpAttributeNames(member).includes('NonAction')) continue
    actions.push(member)
  }
  return actions
}

/**
 * The route-template string of a `[Route("…")]` / `[HttpGet("…")]` attribute on
 * a declaration, or null if no route template literal is present. Returns the
 * first template found across the declaration's verb/route attributes.
 */
export function getRouteTemplate(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const name = attr.childForFieldName('name')?.text?.split('.').pop() ?? ''
      if (name !== 'Route' && !HTTP_VERB_ATTRIBUTES.has(name)) continue
      const argList = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
      const firstArg = argList?.namedChildren.find((c) => c?.type === 'attribute_argument')
      const literal = firstArg?.namedChildren.find((c) => c?.type === 'string_literal')
      if (literal) {
        const content = literal.namedChildren.find((c) => c?.type === 'string_literal_content')
        return content?.text ?? literal.text.replace(/^"|"$/g, '')
      }
    }
  }
  return null
}
