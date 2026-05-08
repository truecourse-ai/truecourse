import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Function returns different types from different paths.
 * Corresponds to sonarjs S3800 (function-return-type).
 * Uses type query to check the return type of the function.
 */

/** Normalize TypeScript literal types to their base types */
function normalizeType(typeStr: string): string {
  // String literal types: "hello", 'world' → string
  if (/^["']/.test(typeStr)) return 'string'
  // Number literal types: 42, 3.14 → number
  if (/^-?\d/.test(typeStr)) return 'number'
  // Boolean literal types
  if (typeStr === 'true' || typeStr === 'false') return 'boolean'
  return typeStr
}

function collectReturnStatements(node: SyntaxNode): SyntaxNode[] {
  const returns: SyntaxNode[] = []
  function walk(n: SyntaxNode) {
    if (n.type === 'return_statement') {
      returns.push(n)
      return
    }
    // Don't descend into nested functions
    if (n.type === 'function_declaration' || n.type === 'function_expression' ||
        n.type === 'arrow_function' || n.type === 'method_definition') {
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node)
  return returns
}

export const functionReturnTypeVariesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-return-type-varies',
  languages: TS_LANGUAGES,
  nodeTypes: ['function_declaration', 'method_definition'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Skip when the function has an explicit return type annotation — the compiler enforces consistency
    const returnType = node.childForFieldName('return_type')
    if (returnType) return null
    // Also check for type_annotation child (some grammars use this)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === 'type_annotation' && child.startPosition.row >= (node.childForFieldName('parameters')?.endPosition.row ?? 0)) {
        return null
      }
    }

    const returnStmts = collectReturnStatements(body)
    if (returnStmts.length < 2) return null

    // Skip framework convention exports whose return type is
    // dictated by the framework, not the function body. Remix /
    // React Router \`meta\` / \`headers\` / \`links\` / \`shouldRevalidate\`
    // exports return framework-defined union types; flagging
    // their per-branch shapes is noise.
    {
      const fnName = node.childForFieldName('name')?.text ?? ''
      const FRAMEWORK_EXPORT_NAMES = new Set([
        'meta', 'headers', 'links', 'shouldRevalidate',
        'loader', 'action', 'clientLoader', 'clientAction',
        'generateMetadata', 'generateStaticParams', 'generateViewport',
        'middleware', 'config',
      ])
      if (FRAMEWORK_EXPORT_NAMES.has(fnName)) {
        // Confirm the function is exported and the file is a route /
        // page entry — minimizes the false-skip risk for unrelated
        // \`meta\` helper functions.
        const isExported = node.parent?.type === 'export_statement'
        const isRouteFile = /[\\/]app[\\/]routes[\\/]/.test(filePath) ||
          /[\\/]app[\\/]/.test(filePath) && /\/(?:page|layout|route|loading|error|not-found|default|head|template)\.[^./]+$/.test(filePath)
        if (isExported || isRouteFile) return null
      }
    }

    // Skip React component functions — they return JSX, fragments,
    // strings, numbers, arrays, and `null` interchangeably; all are
    // valid `React.ReactNode`. The rule's type-string comparison
    // doesn't know that. Detect by ANY return value that contains
    // JSX, or by PascalCase function name in a TSX file.
    function containsJsx(n: SyntaxNode): boolean {
      if (
        n.type === 'jsx_element' ||
        n.type === 'jsx_self_closing_element' ||
        n.type === 'jsx_fragment'
      ) return true
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && containsJsx(c)) return true
      }
      return false
    }
    if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      const fnName = node.childForFieldName('name')?.text ?? ''
      const isPascal = /^[A-Z][a-zA-Z0-9]*$/.test(fnName)
      const anyReturnIsJsx = returnStmts.some((ret) => {
        const v = ret.namedChildren[0]
        return v ? containsJsx(v) : false
      })
      if (isPascal || anyReturnIsJsx) return null
    }

    // Get types of each return value
    const returnTypes = new Set<string>()
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value) {
        returnTypes.add('undefined')
        continue
      }
      const typeStr = typeQuery.getTypeAtPosition(
        filePath,
        value.startPosition.row,
        value.startPosition.column,
        value.endPosition.row,
        value.endPosition.column,
      )
      if (typeStr) {
        // Normalize literal types to their base types:
        // "hello" → string, 42 → number, true → boolean
        returnTypes.add(normalizeType(typeStr))
      }
    }

    // Skip when ALL returns use the same constructor/function call (e.g., all NextResponse.json(...))
    const returnCallNames = new Set<string>()
    let allReturnsAreCallsToSameFunction = true
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value || value.type !== 'call_expression') {
        allReturnsAreCallsToSameFunction = false
        break
      }
      const callee = value.childForFieldName('function')
      if (!callee) {
        allReturnsAreCallsToSameFunction = false
        break
      }
      returnCallNames.add(callee.text)
    }
    if (allReturnsAreCallsToSameFunction && returnCallNames.size === 1) return null

    // Skip when all return expressions are object literals. This is the
    // standard "discriminated union" / "result-shape" pattern — different
    // branches return objects with overlapping but not identical keys
    // (Remix loaders, tRPC procedures, response builders). Without a real
    // type checker we can't tell a meaningful shape mismatch from a
    // legitimate union, and the rule was firing on every Remix loader
    // and every API handler with optional fields.
    const allObjectLiterals = returnStmts.every(ret => {
      const value = ret.namedChildren[0]
      return value && (value.type === 'object' || value.type === 'as_expression')
    })
    if (allObjectLiterals && returnStmts.length >= 2) return null

    // Skip when all returns are calls to obviously-wrapping functions
    // like `Response.json` / `c.json` / `NextResponse.json` that build a
    // typed wire response — different argument shapes are expected.
    const allResponseCalls = returnStmts.every(ret => {
      const value = ret.namedChildren[0]
      if (!value || value.type !== 'call_expression') return false
      const callee = value.childForFieldName('function')
      if (callee?.type !== 'member_expression') return false
      const obj = callee.childForFieldName('object')?.text
      const prop = callee.childForFieldName('property')?.text
      return /^(?:Response|NextResponse|c|ctx|res|reply)$/.test(obj ?? '') &&
        /^(?:json|text|redirect|html|notFound|body)$/.test(prop ?? '')
    })
    if (allResponseCalls) return null

    // Normalize void-like return types: void, Promise<void>, and undefined are semantically equivalent
    const VOID_LIKE = new Set(['void', 'Promise<void>', 'undefined'])
    const normalizedReturnTypes = new Set<string>()
    for (const t of returnTypes) {
      normalizedReturnTypes.add(VOID_LIKE.has(t) ? 'void' : t)
    }

    // If there are significantly different base types
    if (normalizedReturnTypes.size > 1) {
      const types = [...normalizedReturnTypes]
      const baseTypes = types.filter(t => t !== 'null' && t !== 'undefined')

      // Normalize base types: treat empty arrays as compatible with any array type,
      // and objects with same keys but different boolean literal values as same type
      const normalizedBaseTypes = new Set(baseTypes.map(t => {
        // Treat empty array literal types (e.g., "never[]") as "array"
        if (t === 'never[]' || t === '[]') return 'array'
        // Normalize any array type to "array" so they compare equal to empty arrays
        if (t.endsWith('[]')) return 'array'
        return t
      }))

      // Allow nullable returns (type | null), but flag truly mixed returns (string | number)
      if (normalizedBaseTypes.size > 1) {
        const nameNode = node.childForFieldName('name')
        const fnName = nameNode?.text ?? '<anonymous>'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function returns different types',
          `Function \`${fnName}\` returns \`${types.join(' | ')}\` from different code paths — this makes the return type unpredictable.`,
          sourceCode,
          'Ensure consistent return types or explicitly type the function return.',
        )
      }
    }

    return null
  },
}
