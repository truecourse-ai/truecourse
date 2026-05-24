import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const forInWithoutFilterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/for-in-without-filter',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_in_statement'],
  visit(node, filePath, sourceCode) {
    const hasOf = node.children.some((c) => c.type === 'of')
    if (hasOf) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Skip when the iterable is a binding with an explicit TypeScript type
    // annotation (a function parameter typed `Partial<X>` / `Record<K, V>` /
    // mapped type / interface, or a `const … : T = …` declarator). The author
    // has constrained the shape via the type system, so the `for…in` is
    // iterating a known-keys object rather than untrusted data.
    const right = node.childForFieldName('right')
    if (right?.type === 'identifier' && isIdentifierTypedAnnotation(node, right.text)) {
      return null
    }

    function hasOwnPropertyCheck(n: SyntaxNode): boolean {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'member_expression') {
          const prop = fn.childForFieldName('property')
          if (prop?.text === 'hasOwnProperty' || prop?.text === 'hasOwn') return true
        }
      }
      if (n.type === 'string' && (n.text.includes('hasOwnProperty') || n.text.includes('hasOwn'))) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasOwnPropertyCheck(child)) return true
      }
      return false
    }

    if (!hasOwnPropertyCheck(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'for-in without hasOwnProperty check',
        '`for...in` iterates inherited properties. Add an `Object.hasOwn(obj, key)` check inside the loop.',
        sourceCode,
        'Add `if (!Object.hasOwn(obj, key)) continue;` at the start of the loop body, or use `for...of Object.keys(obj)` instead.',
      )
    }
    return null
  },
}

/**
 * True when `name` is declared in any enclosing scope as either a function
 * parameter or a `const`/`let`/`var` declarator with a TS type annotation
 * that constrains the key set — i.e. NOT `Record<string, …>`, `Map<string,
 * …>`, `{[k: string]: …}`, `any`, `unknown`, or `object`. A constrained
 * type means the keys are drawn from a finite set known at compile time, so
 * iterating with `for…in` cannot pick up inherited keys the author didn't
 * anticipate.
 */
function isIdentifierTypedAnnotation(node: SyntaxNode, name: string): boolean {
  let scope: SyntaxNode | null = node.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters') ?? scope.childForFieldName('parameter')
      if (params && paramHasConstrainingType(params, name)) return true
    }
    if (scopeHasConstrainingLocal(scope, name)) return true
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return false
}

function paramHasConstrainingType(params: SyntaxNode, name: string): boolean {
  for (let i = 0; i < params.namedChildCount; i++) {
    const param = params.namedChild(i)
    if (!param) continue
    if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
      const pattern = param.childForFieldName('pattern') ?? param.namedChildren[0]
      const typeAnn = param.childForFieldName('type')
      if (pattern?.type === 'identifier' && pattern.text === name && typeAnn) {
        if (isConstrainingTypeText(typeAnn.text)) return true
      }
    }
  }
  return false
}

function scopeHasConstrainingLocal(scope: SyntaxNode, name: string): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const declName = n.childForFieldName('name')
      const typeAnn = n.childForFieldName('type')
      if (declName?.type === 'identifier' && declName.text === name && typeAnn) {
        if (isConstrainingTypeText(typeAnn.text)) {
          found = true
          return
        }
      }
    }
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(scope)
  return found
}

function isConstrainingTypeText(text: string): boolean {
  // `text` includes the leading colon from the field — strip it.
  const t = text.replace(/^\s*:\s*/, '').trim()
  // Untyped escape hatches.
  if (/\b(any|unknown)\b/.test(t)) return false
  if (t === 'object' || t === 'Object' || t === '{}') return false
  // Unbounded string-keyed records / maps.
  if (/\bRecord\s*<\s*string\b/.test(t)) return false
  if (/\b(Map|WeakMap)\s*<\s*string\b/.test(t)) return false
  // `{[k: string]: …}` index signature.
  if (/\[\s*\w+\s*:\s*string\s*\]\s*:/.test(t)) return false
  return true
}
