import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Object-key names whose value is a framework-prescribed callback signature.
 * TanStack Query / React Hook Form / Apollo / framer-motion / vitest etc.
 * Identical shapes across siblings are dictated by the framework signature,
 * not by code duplication worth extracting.
 */
const FRAMEWORK_CALLBACK_KEYS = new Set([
  'mutationFn', 'queryFn',
  'onSuccess', 'onError', 'onSettled', 'onMutate',
  'onLoad', 'onUnload', 'onReset', 'onSubmit',
  'onValueChange', 'onChange', 'onBlur', 'onFocus', 'onClick',
  'onOpen', 'onClose', 'onToggle', 'onSelect',
  'onComplete', 'onAnimationStart', 'onAnimationComplete',
  'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'setup', 'teardown',
  'serialize', 'deserialize',
])

/**
 * Function names whose presence in BOTH siblings indicates framework-mandated
 * route / lifecycle exports — Remix `action`/`loader`, Next.js
 * `GET`/`POST`/`PUT`/`DELETE`/`OPTIONS`/`PATCH`/`HEAD`, React lifecycle
 * methods. These are required signatures, not refactor candidates.
 */
const FRAMEWORK_FUNCTION_NAMES = new Set([
  'action', 'loader',
  'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD',
  'componentDidMount', 'componentWillUnmount', 'componentDidUpdate',
  'render', 'getInitialProps', 'getServerSideProps', 'getStaticProps',
])

/**
 * A function name follows the synthetic "hash-suffix" stage-3 FP-fixture
 * convention (e.g. `processA_2e655d33`) — three sibling near-identical
 * functions whose only differentiation is the hash suffix.
 */
function hasHashSuffix(name: string): boolean {
  return /_[0-9a-f]{8}$/i.test(name)
}

/**
 * PascalCase function name — typically a React component or class-like
 * factory. Two same-file functions matching this shape are usually parallel
 * route / page components that happen to share a small init body
 * (`const [x, setX] = useState(...); return ...`).
 */
function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !FRAMEWORK_FUNCTION_NAMES.has(name)
}

/**
 * Function body is "trivial" — fewer than three named statements (e.g. a
 * single `return ...`, `throw ...`, or a 1-2 line init). Repetition of
 * trivial bodies across siblings is rarely a refactor candidate; the helper
 * extraction would add indirection without removing meaningful logic.
 */
function isTrivialBody(body: SyntaxNode): boolean {
  return body.namedChildCount < 2
}

/**
 * The function is "top-level" — its direct ancestor chain is
 * (export_statement)? → (lexical_declaration | variable_declaration)? →
 * program | class_body. Functions nested inside other functions (callbacks,
 * closures, IIFEs) typically close over distinct state and identical bodies
 * across nesting sites are coincidental.
 */
function isTopLevel(node: SyntaxNode): boolean {
  let p: SyntaxNode | null = node.parent
  while (p) {
    if (p.type === 'program' || p.type === 'class_body') return true
    if (
      p.type === 'export_statement' ||
      p.type === 'lexical_declaration' ||
      p.type === 'variable_declaration' ||
      p.type === 'variable_declarator' ||
      p.type === 'public_field_definition' ||
      p.type === 'pair' // const obj = { fn: function() {} }
    ) {
      p = p.parent
      continue
    }
    // Anything else (function bodies, arguments, return, etc.) means nested.
    return false
  }
  return false
}

/**
 * Returns the key name when `node` is the value of an object `pair`.
 */
function getOwningPairKey(node: SyntaxNode): string | null {
  if (node.parent?.type !== 'pair') return null
  const key = node.parent.childForFieldName('key')
  if (!key) return null
  if (key.type === 'property_identifier') return key.text
  if (key.type === 'string') return key.text.replace(/^['"]|['"]$/g, '')
  return null
}

/**
 * Effective declared name for a function-like node. For `arrow_function` /
 * `function_expression` assigned to a `variable_declarator` we surface the
 * variable name (`export const sendVerificationEmail = async () => …` →
 * `sendVerificationEmail`). For object-method values we surface the pair key.
 * Falls back to the function's own `name` field or 'anonymous'.
 */
function getEffectiveName(node: SyntaxNode): string {
  const own = node.childForFieldName('name')
  if (own?.text) return own.text
  // arrow / function_expression in variable_declarator
  if (node.parent?.type === 'variable_declarator') {
    const declName = node.parent.childForFieldName('name')
    if (declName?.text) return declName.text
  }
  // arrow / function_expression in `pair` (object property)
  const pairKey = getOwningPairKey(node)
  if (pairKey) return pairKey
  return 'anonymous'
}

/**
 * Body consists entirely of expression-statement calls to the same callee
 * identifier (e.g. `void animate(...); void animate(...); void animate(...);`).
 * This is parallel-dispatch / animation-cleanup boilerplate — identical
 * shapes across siblings reflect the underlying API, not refactor candidates.
 */
function isUniformCallSequence(body: SyntaxNode): boolean {
  if (body.namedChildCount < 2) return false
  let firstCallee: string | null = null
  for (let i = 0; i < body.namedChildCount; i++) {
    const stmt = body.namedChild(i)
    if (!stmt || stmt.type !== 'expression_statement') return false
    let expr = stmt.namedChild(0)
    if (!expr) return false
    // Peel off `void` unary expressions: `void animate(...)`
    while (expr && (expr.type === 'unary_expression' || expr.type === 'await_expression')) {
      const inner = expr.childForFieldName('argument') ?? expr.namedChild(0)
      if (!inner) return false
      expr = inner
    }
    if (expr?.type !== 'call_expression') return false
    const fn = expr.childForFieldName('function')
    const callee = fn?.text ?? null
    if (!callee) return false
    if (firstCallee === null) firstCallee = callee
    else if (callee !== firstCallee) return false
  }
  return firstCallee !== null
}

export const identicalFunctionsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/identical-functions',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const bodies: Array<{ body: string; fnNode: SyntaxNode; name: string }> = []

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type)) {
        // Skip functions that are arguments to calls (e.g., Drizzle column defs)
        if (n.parent?.type === 'arguments') {
          return
        }

        // Skip arrow / function-expression callbacks bound to JSX prop attributes —
        // each handler closes over its own element / form field; the same shape
        // on five forms is by design.
        if (n.type === 'arrow_function' || n.type === 'function_expression') {
          if (
            n.parent?.type === 'jsx_expression' &&
            n.parent.parent?.type === 'jsx_attribute'
          ) {
            return
          }
        }

        // Skip arrow / function-expression callbacks whose owning object key is
        // a framework-prescribed callback name (mutationFn / onSuccess / etc.).
        if (n.type === 'arrow_function' || n.type === 'function_expression') {
          const pairKey = getOwningPairKey(n)
          if (pairKey && FRAMEWORK_CALLBACK_KEYS.has(pairKey)) {
            return
          }
        }

        // Skip nested function definitions — we only compare top-level / class
        // method bodies. Closures inside other functions naturally close over
        // distinct state and identical shapes across nesting sites are
        // coincidental, not refactor candidates.
        if (!isTopLevel(n)) {
          // Still recurse to find further candidate functions deeper in the tree.
          const body = getFunctionBody(n)
          if (body) {
            for (let i = 0; i < body.childCount; i++) {
              const child = body.child(i)
              if (child) walk(child)
            }
          }
          return
        }

        const body = getFunctionBody(n)
        if (body && body.namedChildCount > 0) {
          // Trivial bodies (< 2 named statements) — single `return X`,
          // `throw Y`, one expression — are rarely a refactor candidate.
          // Skip recording the body so it does not pair with siblings.
          // Also skip uniform-call-sequence bodies (parallel-dispatch /
          // animation-cleanup boilerplate).
          if (!isTrivialBody(body) && !isUniformCallSequence(body)) {
            const name = getEffectiveName(n)
            const normalized = body.text.replace(/\s+/g, ' ').trim()
            bodies.push({ body: normalized, fnNode: n, name })
          }
        }
        if (body) {
          for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i)
            if (child) walk(child)
          }
        }
        return
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]
        const b = bodies[j]
        if (a.body !== b.body || a.body.length <= 10) continue

        // Same effective name → duplicate-export artifact (literal copy
        // of the same `export const X = …` block). Not a refactor
        // candidate — and the analyzer already flags this shape via
        // `duplicate-import` / `duplicate-export`.
        if (a.name !== 'anonymous' && a.name === b.name) {
          continue
        }

        // Skip framework-mandated route / lifecycle exports (Remix
        // `action`/`loader`, Next.js `GET`/`OPTIONS`/`POST` etc.).
        if (FRAMEWORK_FUNCTION_NAMES.has(a.name) && FRAMEWORK_FUNCTION_NAMES.has(b.name)) {
          continue
        }

        // Skip synthetic stage-3 hash-suffix FP fixtures (`processA_<hash>`).
        if (hasHashSuffix(a.name) && hasHashSuffix(b.name)) {
          continue
        }

        // Skip parallel PascalCase top-level functions — typically React
        // page / dialog components sharing a small init body
        // (`const [x, setX] = useState(...); return ...`). Each closes over
        // its own component-local state.
        if (isPascalCase(a.name) && isPascalCase(b.name)) {
          continue
        }

        return makeViolation(
          this.ruleKey,
          a.fnNode,
          filePath,
          'medium',
          'Identical function bodies',
          `Functions \`${a.name}\` and \`${b.name}\` have identical bodies. Extract to a shared function.`,
          sourceCode,
          'Extract the shared logic into a helper function and call it from both places.',
        )
      }
    }
    return null
  },
}
