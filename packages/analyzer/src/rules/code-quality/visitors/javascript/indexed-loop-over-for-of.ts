import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from './_helpers.js'

// Recognised typed-array constructors. Loops over typed-array `.length` are not
// idiomatic for-of candidates — code that does byte-level indexing into a
// Uint8Array etc. is usually intentional and should not be flagged.
const TYPED_ARRAY_CTORS = new Set([
  'Uint8Array', 'Uint8ClampedArray', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
])

function isInLoopHeader(n: SyntaxNode, condition: SyntaxNode | null, increment: SyntaxNode | null, initializer: SyntaxNode | null): boolean {
  let p: SyntaxNode | null = n.parent
  while (p) {
    if (p.id === condition?.id || p.id === increment?.id || p.id === initializer?.id) return true
    p = p.parent
  }
  return false
}

function enclosingFunctionLike(n: SyntaxNode): SyntaxNode | null {
  let p: SyntaxNode | null = n.parent
  while (p) {
    if (
      p.type === 'function_declaration' ||
      p.type === 'function_expression' ||
      p.type === 'arrow_function' ||
      p.type === 'method_definition' ||
      p.type === 'generator_function_declaration' ||
      p.type === 'generator_function'
    ) return p
    p = p.parent
  }
  return null
}

// Heuristic: find the binding of `name` in the enclosing function scope and
// return 'typed-array' when it is `new <TypedArray>(...)`, 'local' for other
// local declarations, 'param' when declared as a function parameter, or null
// when no binding is visible. We only walk the enclosing function (and outward)
// — good enough for the for-of-candidate decision.
function classifyBinding(forNode: SyntaxNode, name: string): 'typed-array' | 'local' | 'param' | null {
  const fn = enclosingFunctionLike(forNode)
  if (!fn) return null

  const params = fn.childForFieldName('parameters')
  if (params) {
    let isParam = false
    const walkParams = (n: SyntaxNode) => {
      if (isParam) return
      if (n.type === 'identifier' && n.text === name) {
        isParam = true
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walkParams(c)
      }
    }
    walkParams(params)
    if (isParam) return 'param'
  }

  // Look for `const/let/var name = new <Ctor>(...)` declarations inside the
  // function body. Returns 'typed-array' if matched, else 'local' if any
  // variable_declarator with this name is found.
  const body = fn.childForFieldName('body')
  let result: 'typed-array' | 'local' | null = null
  function walk(n: SyntaxNode) {
    if (result === 'typed-array') return
    if (n.type === 'variable_declarator') {
      const nameNode = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (nameNode?.text === name) {
        if (value?.type === 'new_expression') {
          const ctor = value.childForFieldName('constructor')
          if (ctor && ctor.type === 'identifier' && TYPED_ARRAY_CTORS.has(ctor.text)) {
            result = 'typed-array'
            return
          }
        }
        if (!result) result = 'local'
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c)
    }
  }
  if (body) walk(body)
  return result
}

export const indexedLoopOverForOfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/indexed-loop-over-for-of',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')
    const body = node.childForFieldName('body')

    if (!initializer || !condition || !increment || !body) return null

    if (initializer.type !== 'lexical_declaration' && initializer.type !== 'variable_declaration') return null
    const declarator = initializer.namedChildren.find((c) => c.type === 'variable_declarator')
    if (!declarator) return null
    const indexNameNode = declarator.childForFieldName('name')
    const initValue = declarator.childForFieldName('value')
    if (!indexNameNode || initValue?.text !== '0') return null
    const indexName = indexNameNode.text

    const isIncrement = increment.type === 'update_expression'
      && increment.text.includes(indexName)
    if (!isIncrement) return null

    const condText = condition.text
    if (!condText.includes(indexName)) return null

    // Skip when the loop condition uses arithmetic on .length (e.g., arr.length - 1)
    // indicating a partial range iteration that for-of cannot replicate
    const lengthArithmeticRe = /\.length\s*[-+*/]/
    if (lengthArithmeticRe.test(condText)) return null

    // Require the condition to bound `i` by `<identifier>.length` (a full-array
    // iteration). A bound like `i < window` or `i < currentIndex` is a numeric
    // counter loop — `for-of` is not applicable since there is no array to
    // iterate, or only a partial slice.
    const lengthBoundMatch = condText.match(/([A-Za-z_$][\w$]*)\.length\b/)
    if (!lengthBoundMatch) return null
    const arrayName = lengthBoundMatch[1]

    // Collect every body usage of `i` that is NOT a subscript on `arrayName`,
    // and count subscripts on `arrayName[i]` specifically.
    let usedOutsideIndex = false
    let arraySubscriptCount = 0
    let foreignSubscriptCount = 0
    function checkIndexUsage(n: SyntaxNode) {
      if (n.type === 'identifier' && n.text === indexName) {
        const parent = n.parent
        if (parent?.type === 'subscript_expression' && parent.childForFieldName('index')?.id === n.id) {
          const obj = parent.childForFieldName('object')
          if (obj && obj.type === 'identifier' && obj.text === arrayName) {
            arraySubscriptCount++
          } else {
            // `i` indexes a different array — for-of over `arrayName` would
            // leave the other index dangling. Treat this as "i used elsewhere".
            foreignSubscriptCount++
          }
        } else if (!isInLoopHeader(n, condition, increment, initializer)) {
          usedOutsideIndex = true
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) checkIndexUsage(child)
      }
    }
    checkIndexUsage(body)

    // Reject if `i` is used for anything other than `arrayName[i]`.
    if (usedOutsideIndex || foreignSubscriptCount > 0 || arraySubscriptCount === 0) return null

    // The candidate must be a simple transform loop: the body should be a
    // single statement performing the array access. Multi-statement bodies are
    // often signal of more complex per-iteration logic (nested loops, side
    // effects) where the rewrite is non-trivial and the index may matter.
    const stmts = body.type === 'statement_block'
      ? body.namedChildren.filter((c) => !c.type.endsWith('_comment'))
      : [body]
    if (stmts.length !== 1) return null

    // Skip if the body has any `await` expression — sequential awaits over a
    // counter index is usually a deliberate orchestration pattern, and the
    // `await-in-loop` rule already covers it.
    let hasAwait = false
    function findAwait(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await_expression') { hasAwait = true; return }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) findAwait(c)
      }
    }
    findAwait(body)
    if (hasAwait) return null

    // Skip loops indexing into a typed-array (Uint8Array, etc.). Byte-level
    // numeric processing is usually intentional and may rely on the explicit
    // index for clarity or performance.
    const binding = classifyBinding(node, arrayName)
    if (binding === 'typed-array') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Indexed loop when index not needed',
      `Index variable \`${indexName}\` is only used for array access. Use \`for...of\` instead.`,
      sourceCode,
      `Replace with \`for (const item of ${arrayName}) { ... }\`.`,
    )
  },
}
