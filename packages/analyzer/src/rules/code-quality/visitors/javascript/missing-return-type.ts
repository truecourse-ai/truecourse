import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Framework-mandated exports whose return type is dictated by the framework
// (Next.js App Router, Remix, etc.) — annotations would be redundant and the
// codebase-wide convention is to omit them.
const FRAMEWORK_FUNCTION_NAMES = new Set<string>([
  // HTTP method handlers (Next.js Route Handlers, Remix resource routes)
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'OPTIONS',
  'HEAD',
  // Remix data conventions
  'loader',
  'action',
  'meta',
  'headers',
  'links',
  'shouldRevalidate',
  'handle',
  'ErrorBoundary',
  'CatchBoundary',
  'HydrateFallback',
  // Next.js App Router conventions
  'generateStaticParams',
  'generateMetadata',
  'generateImageMetadata',
  'generateViewport',
  'generateSitemaps',
  'middleware',
  'config',
  // Next.js special files (route segment configs)
  'sitemap',
  'robots',
  'manifest',
])

// Common option-bag callback property names (TanStack Query / Apollo / TRPC /
// React Hook Form / event-emitter style APIs). When such a method appears as
// a property in an options object literal, its signature is constrained by
// the surrounding API contract.
const OPTION_BAG_CALLBACK_NAMES = new Set<string>([
  'onSuccess',
  'onError',
  'onSettled',
  'onMutate',
  'onLoad',
  'onUnload',
  'onReset',
  'onSubmit',
  'onChange',
  'onBlur',
  'onFocus',
  'onClick',
  'onOpen',
  'onClose',
  'onToggle',
  'onSelect',
  'onComplete',
  'onAllReady',
  'onShellReady',
  'onShellError',
  'onUploadSuccess',
  'onUploadError',
  'mutationFn',
  'queryFn',
])

function isJsxLike(type: string): boolean {
  return (
    type === 'jsx_element' ||
    type === 'jsx_self_closing_element' ||
    type === 'jsx_fragment'
  )
}

// Walk the function body looking for a returned JSX expression. We stop
// descending into nested functions/methods so we don't conflate the current
// function with an inner callback that happens to render JSX.
function bodyReturnsJsx(node: any): boolean {
  const NESTED_FN_TYPES = new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
    'generator_function',
    'generator_function_declaration',
  ])
  const stack: any[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c) stack.push(c)
  }
  while (stack.length > 0) {
    const n = stack.pop()
    if (!n) continue
    if (NESTED_FN_TYPES.has(n.type)) continue
    if (n.type === 'return_statement') {
      for (let i = 0; i < n.childCount; i++) {
        const ret = n.child(i)
        if (ret && isJsxLike(ret.type)) return true
        if (ret && ret.type === 'parenthesized_expression') {
          for (let j = 0; j < ret.childCount; j++) {
            const inner = ret.child(j)
            if (inner && isJsxLike(inner.type)) return true
          }
        }
      }
      continue
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return false
}

// True for `set foo(...)` and `get foo()` accessor method_definitions.
// TS forbids return type on setters; getters are commonly inferred and
// adding the annotation is not idiomatic in component/utility codebases.
function isAccessorMethod(node: any): 'set' | 'get' | null {
  const first = node.child(0)
  if (!first) return null
  if (first.type === 'set' || first.text === 'set') return 'set'
  if (first.type === 'get' || first.text === 'get') return 'get'
  return null
}

// Walk up to find an enclosing `export default` statement. Default-exported
// functions are framework-mandated (Next.js pages, Remix routes, etc.).
function isDefaultExport(node: any): boolean {
  const parent = node.parent
  if (!parent || parent.type !== 'export_statement') return false
  for (let i = 0; i < parent.childCount; i++) {
    const c = parent.child(i)
    if (c && (c.type === 'default' || c.text === 'default')) return true
  }
  return false
}

// True if this node is directly wrapped by an `export` statement (named or
// default). Used to keep public-API helpers flagged while silencing
// module-private helpers.
function isExportedDeclaration(node: any): boolean {
  const parent = node.parent
  return !!parent && parent.type === 'export_statement'
}

// True when the method_definition is a property of an object literal —
// i.e. it appears inside an `object` node, not inside a `class_body`.
// These are option-bag callbacks (TanStack onSuccess/onError, lifecycle
// listeners, etc.) whose signature is constrained by the outer API.
function isObjectLiteralMethod(node: any): boolean {
  const parent = node.parent
  return !!parent && parent.type === 'object'
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name)
}

function isReactHookName(name: string): boolean {
  return /^use[A-Z]/.test(name)
}

export const missingReturnTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-return-type',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['function_declaration', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Only flag named functions (not arrow functions)
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null

    // Check if there is a return_type annotation
    const returnType = node.childForFieldName('return_type')
    if (returnType) return null

    const name = nameNode.text

    // Skip constructors
    if (name === 'constructor') return null

    // method_definition-specific skips
    if (node.type === 'method_definition') {
      // Getter/setter accessors. TS forbids return type on setters; getters
      // are conventionally inferred.
      if (isAccessorMethod(node)) return null

      // Option-bag callback methods (onSuccess/onError/onShellReady/etc.) on
      // object literals. Their signature is dictated by the surrounding API
      // contract (TanStack/Apollo/TRPC/Remix entry options).
      if (isObjectLiteralMethod(node) && OPTION_BAG_CALLBACK_NAMES.has(name)) {
        return null
      }
    }

    // Skip framework-mandated exports (Next.js / Remix route handlers,
    // lifecycle functions, route segment configs). The return type is
    // dictated by the framework signature and is not idiomatic to annotate.
    if (FRAMEWORK_FUNCTION_NAMES.has(name)) return null

    // Skip default-exported functions (Next.js pages, Remix layouts/routes,
    // entry modules) — their return type is framework-conventional.
    if (isDefaultExport(node)) return null

    // Skip PascalCase function declarations that actually return JSX. These
    // are React components whose return type (`JSX.Element` / `ReactNode`)
    // is trivially inferred; the codebase-wide convention is to omit it.
    // We require BOTH the name shape AND a JSX-returning body so that
    // non-component PascalCase helpers (rare) still get flagged.
    if (node.type === 'function_declaration' && isPascalCase(name)) {
      const body = node.childForFieldName('body')
      if (body && bodyReturnsJsx(body)) return null
    }

    // Skip non-exported React hook declarations (`use*` naming). Exported
    // hooks remain part of the module's public API and should retain return
    // type annotations.
    if (
      node.type === 'function_declaration' &&
      isReactHookName(name) &&
      !isExportedDeclaration(node)
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      `Missing return type on function '${name}'`,
      `Function \`${name}\` is missing an explicit return type annotation.`,
      sourceCode,
      `Add a return type: \`function ${name}(...): ReturnType { ... }\``,
    )
  },
}
