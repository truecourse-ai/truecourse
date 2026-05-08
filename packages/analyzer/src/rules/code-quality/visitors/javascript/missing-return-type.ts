import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { isFrameworkFunctionName, isReactComponentName, isReactCustomHookName } from './_helpers.js'

/**
 * True if `node` is a `function_definition` / `method_definition`
 * whose immediate scope is another function — a nested local
 * helper, not a public API surface.
 */
function isNestedLocalFunction(node: SyntaxNode): boolean {
  let cursor: SyntaxNode | null = node.parent
  while (cursor) {
    if (cursor.type === 'function_declaration' || cursor.type === 'function_expression' ||
        cursor.type === 'arrow_function' || cursor.type === 'method_definition') return true
    if (cursor.type === 'class_body' || cursor.type === 'program') return false
    cursor = cursor.parent
  }
  return false
}

/**
 * True if `node` is a method-shorthand inside an object literal
 * passed as an argument to a call (e.g. `useMutation({ onSuccess() {} })`,
 * `renderToPipeableStream(req, { onError(e) {} })`). The
 * containing object's TS type contextually constrains the return
 * type — explicit annotation duplicates the framework contract.
 *
 * Tree-sitter shape: method_definition → object → arguments → call_expression.
 */
function isMethodShorthandInOptionBag(node: SyntaxNode): boolean {
  if (node.type !== 'method_definition') return false
  const parent = node.parent
  if (parent?.type !== 'object') return false
  const args = parent.parent
  if (args?.type !== 'arguments') return false
  return args.parent?.type === 'call_expression'
}

/**
 * True if `node` is a getter/setter accessor. Setters can't have
 * meaningful return types, and getter return types are inferred
 * from the body just as well as from an explicit annotation.
 */
function isAccessor(node: SyntaxNode): boolean {
  if (node.type !== 'method_definition') return false
  for (const c of node.children) {
    if (c.type === 'get' || c.type === 'set') return true
    if (c.text === 'get' || c.text === 'set') return true
  }
  return false
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

    // Skip framework-convention functions whose return type is
    // fixed by the runtime (Next.js Page/Layout/route handlers,
    // Remix loaders/actions, HTTP method exports). Annotating
    // them adds noise without strengthening any API surface.
    if (isFrameworkFunctionName(name)) return null

    // Skip React components — PascalCase functions are
    // overwhelmingly components; their return type (`JSX.Element`
    // / `ReactNode`) is conventional and well-inferred.
    if (isReactComponentName(name)) return null

    // Skip React custom hooks — `useX` functions return inferred
    // objects (often from `useMutation` / `useQuery`); explicit
    // annotations duplicate the inference and break when the
    // underlying lib types change.
    if (isReactCustomHookName(name)) return null

    // Skip nested local functions — helpers inside another
    // function body, not part of the public API surface.
    if (isNestedLocalFunction(node)) return null

    // Skip method-shorthand inside an option-bag object passed
    // to a call: `useMutation({ onSuccess() {…}, onError(err) {…} })`,
    // `renderToPipeableStream(req, { onShellError() {…} })`.
    // The framework's option-bag type carries the contract.
    if (isMethodShorthandInOptionBag(node)) return null

    // Skip getter / setter accessors.
    if (isAccessor(node)) return null

    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      `Missing return type on function '${name}'`,
      `Function \`${name}\` is missing an explicit return type annotation.`,
      sourceCode,
      `Add a return type: \`function ${name}(...): ReturnType { ... }\``,
    )
  },
}
