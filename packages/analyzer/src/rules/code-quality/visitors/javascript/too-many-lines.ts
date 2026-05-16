import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsJsx } from '../../../_shared/javascript-helpers.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'

// React hook naming convention: any identifier starting with `use` followed by
// an uppercase letter or digit (`useState`, `useEffect`, `useDebouncedSave`,
// `use2FA`, …).
const HOOK_NAME_RE = /^use[A-Z0-9]/

/**
 * Function-style name resolution that also handles arrow / function expressions
 * assigned to a `const`/`let`/`var` binding:
 *
 *   const useFoo = () => { … }   // name = "useFoo"
 *   const useFoo = function() {} // name = "useFoo"
 *
 * Falls back to `getFunctionName` (which reads the `name` field on
 * function_declaration / method_definition) when no enclosing
 * variable_declarator is found.
 */
function resolveFunctionName(node: SyntaxNode): string {
  const direct = getFunctionName(node)
  if (direct && direct !== 'anonymous') return direct
  // Walk up at most one variable_declarator parent for arrow/function expressions.
  const parent = node.parent
  if (parent && parent.type === 'variable_declarator') {
    const nameNode = parent.childForFieldName('name')
    if (nameNode && nameNode.type === 'identifier') return nameNode.text
  }
  return direct
}

/**
 * A function is treated as a React custom hook when its name matches the
 * `use[A-Z]…` community convention. This intentionally accepts hooks whose
 * inner body has no hook calls (e.g. `useTelemetry` that only wraps a config
 * object) because such hooks are still part of React's component-system
 * boilerplate, not standalone decomposable logic.
 */
function isCustomHook(node: SyntaxNode): boolean {
  const name = resolveFunctionName(node)
  return HOOK_NAME_RE.test(name)
}

/**
 * Returns true when `node` is being passed as an argument to a React hook
 * call (e.g. the arrow in `useEffect(() => …)`, `useCallback(() => …, deps)`,
 * `useMemo(() => …, deps)`). These callbacks belong to the surrounding React
 * component / hook and their length reflects framework boilerplate, not a
 * standalone function the developer can decompose without restructuring the
 * component.
 */
function isHookCallback(node: SyntaxNode): boolean {
  // arguments → call_expression(useX)
  const args = node.parent
  if (!args || args.type !== 'arguments') return false
  const call = args.parent
  if (!call || call.type !== 'call_expression') return false
  const callee = call.childForFieldName('function')
  if (!callee) return false
  if (callee.type === 'identifier' && HOOK_NAME_RE.test(callee.text)) return true
  if (callee.type === 'member_expression') {
    const prop = callee.childForFieldName('property')
    if (prop && prop.type === 'property_identifier' && HOOK_NAME_RE.test(prop.text)) return true
  }
  return false
}

export const tooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount <= 50) return null

    // Skip React components: JSX markup inflates the line count without
    // representing decomposable logic. Detected by the function body
    // containing JSX elements/fragments anywhere in its tree.
    if (containsJsx(bodyNode)) return null

    // Skip React custom hooks: their length comes from hook setup and
    // return-shape boilerplate rather than excess logic.
    if (isCustomHook(node)) return null

    // Skip arrow / function expressions that are arguments to a React hook
    // call (useEffect/useCallback/useMemo/…). Their length belongs to the
    // enclosing component's framework boilerplate.
    if (isHookCallback(node)) return null

    const name = getFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Function too long',
      `Function \`${name}\` has ${lineCount} lines (max 50). Split into smaller, focused functions.`,
      sourceCode,
      'Extract logical sections into separate helper functions.',
    )
  },
}
