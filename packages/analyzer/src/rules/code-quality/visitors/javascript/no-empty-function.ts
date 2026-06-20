import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionBody } from './_helpers.js'

// TS parameter-property shorthand: any constructor parameter prefixed
// with `private` / `public` / `protected` / `readonly` is implicitly
// assigned to a same-named instance field. A constructor whose only
// "logic" is parameter properties looks empty to the AST but is not.
function hasParameterProperty(params: SyntaxNode): boolean {
  for (let i = 0; i < params.namedChildCount; i++) {
    const param = params.namedChild(i)
    if (!param) continue
    if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue
    for (let j = 0; j < param.childCount; j++) {
      const child = param.child(j)
      if (!child) continue
      if (child.type === 'accessibility_modifier') return true
      if (child.text === 'readonly') return true
    }
  }
  return false
}

export const jsNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode || bodyNode.type !== 'statement_block') return null

    if (bodyNode.namedChildren.length > 0) return null

    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type === 'comment') return null
    }

    // Skip empty functions used as intentional no-ops:
    //  - any function expression / arrow passed as a call argument
    //    (`.catch(() => {})`, `useRef(() => {})`, `useEffect(noop, [])`,
    //    `cb ?? (() => {})` after default-arg substitution) — the caller
    //    asked for a callable and the empty body is the placeholder
    //  - JSX attribute value — `onClick={() => {}}` placeholder
    //  - return value of another function — `return () => {}` no-op
    //  - default in `||` / `??` fallback — `cb || (() => {})`
    let parent = node.parent
    while (parent?.type === 'parenthesized_expression') parent = parent.parent
    if (parent?.type === 'arguments') return null
    if (parent?.type === 'jsx_expression' || parent?.type === 'jsx_attribute') return null
    if (parent?.type === 'return_statement') return null
    // Object-property value — `{ cleanup: async () => {} }` provides a
    // deliberate no-op callable for an interface/config slot.
    if (parent?.type === 'pair') return null
    if (parent?.type === 'binary_expression') {
      const op = parent.childForFieldName('operator')
      if (op?.text === '||' || op?.text === '??') return null
    }

    // Skip TypeScript parameter-property constructors. `constructor(
    // private opts: T) {}` and `constructor(readonly db: Db) {}` are
    // not bodyless: the access modifier / `readonly` keyword on a
    // parameter expands to `this.opts = opts` / `this.db = db` at
    // class-init time. The empty body is the *whole point* of the
    // shorthand.
    if (node.type === 'method_definition') {
      let isConstructor = false
      let hasRestrictedAccess = false
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (child.type === 'property_identifier' && child.text === 'constructor') isConstructor = true
        if (child.type === 'accessibility_modifier') {
          const txt = child.text.trim()
          if (txt === 'private' || txt === 'protected') hasRestrictedAccess = true
        }
      }
      if (isConstructor && hasRestrictedAccess) return null
      if (isConstructor) {
        const params = node.childForFieldName('parameters')
        if (params && hasParameterProperty(params)) return null
      }
    }

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw a "not implemented" error, or add a comment explaining why the body is empty.',
    )
  },
}
