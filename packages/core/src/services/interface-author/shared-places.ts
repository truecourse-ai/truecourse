/**
 * SHARED PLACES — the UI several screens render, authored ONCE as a place of its
 * own instead of by every screen (or by none).
 *
 * A screen session reads its route module and the modules it renders. The
 * layout's sidebar, a list's card actions, the search modal are rendered by a
 * dozen screens, and each screen's session reasonably decides they are "the
 * shared layout's", so nobody authors them. Ownership is the gap, and the
 * grounding already holds the answer: a component module in the RENDER CLOSURE
 * of two or more screens (however deep, and through the layouts the framework
 * wraps them in), which OWNS BEHAVIOR of its own, is a shared place — kind
 * `component`, an id derived from its module path, authored by one session at a
 * screen that renders it. A building block (a button, a modal wrapper, a
 * dropdown primitive) owns none: whatever it does comes from the props its
 * caller hands it, so its tasks belong to the caller.
 *
 * Pure: the screens' grounding and a source reader in, the places out, the same
 * input always giving the same places in the same order.
 */

import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'
import type { WebPlaceContext } from '@truecourse/interface-mapper'

/** One component module rendered by several screens, and the place it becomes. */
export interface SharedComponent {
  /** `component-<name>-<hash>`: stable for as long as the module path is. */
  id: string
  /** The module, repo-relative. */
  module: string
  /** The component's name as its file names it — `LinkActions`. */
  title: string
  /** The screens that render it, in the order the grounding lists them. */
  screens: string[]
}

/** How many screens must render a module before it is shared. */
const MIN_SCREENS = 2

/** A JSX attribute that takes an event handler: `onClick`, `onSubmit`, `onClickOutside`. */
const HANDLER_ATTRIBUTE = /^on[A-Z]/

/** The attributes that name where a link goes: `href`, and React Router's `to`. */
const ADDRESS_ATTRIBUTES = new Set(['href', 'to'])

/** The hooks whose second binding only changes the component's own UI state. */
const LOCAL_STATE_HOOKS = new Set(['useState', 'useReducer'])

/** The calls whose result is a handle on the component's own element: what it does through one stays its own UI. */
const LOCAL_REF_CALLS = new Set(['useRef', 'createRef'])

/** The hooks that wrap a function the component declares: the function they are handed is the helper. */
const FUNCTION_WRAPPING_HOOKS = new Set(['useCallback', 'useMemo'])

/** How an address starts: a path from the root or relative to the page, a URL, a mail link. */
const ADDRESS_PREFIXES = ['/', './', '../', 'http://', 'https://', 'mailto:']

/** How many local helpers deep a handler is followed. */
const MAX_HELPER_DEPTH = 3

export interface DetectSharedComponentsInput {
  /** Screen id → its grounding. Only screens: a component's own grounding is not an input. */
  contexts: ReadonlyMap<string, WebPlaceContext>
  /** A module's source, repo-relative path in; undefined when it cannot be read. */
  readSource: (module: string) => string | undefined
}

/**
 * The shared components of a set of screens: every module in the render
 * closure of two or more screens, that is no screen's own route module, and
 * that owns behavior. Most widely rendered first, ties by path.
 */
export function detectSharedComponents(input: DetectSharedComponentsInput): SharedComponent[] {
  const routeModules = new Set([...input.contexts.values()].map((context) => context.module))
  const renderedBy = new Map<string, string[]>()
  for (const [screen, context] of input.contexts) {
    for (const module of new Set(context.renderClosure)) {
      if (routeModules.has(module)) continue
      renderedBy.set(module, [...(renderedBy.get(module) ?? []), screen])
    }
  }
  return [...renderedBy.entries()]
    .filter(([, screens]) => screens.length >= MIN_SCREENS)
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .filter(([module]) => ownsBehavior(module, input.readSource(module)))
    .map(([module, screens]) => ({ id: sharedComponentId(module), module, title: componentName(module), screens }))
}

/**
 * Does this component do something of its own? It does when a handler reaches
 * past what it was handed (an imported function, a hook's action, the router,
 * a store), following local helpers such as `handleDelete` into their bodies,
 * or when it names an address of its own: a link's `href`/`to`, or one in the
 * link data it hands a renderer (`[{ href: "/settings/account" }]`). A handler that only calls or forwards
 * a prop (`onClick={onClick}`, `() => toggleModal()`) or only flips local state
 * (`setOpen(!open)`) owns nothing, and neither does a link whose `href` is a
 * prop. A module that does not parse owns nothing.
 */
export function ownsBehavior(module: string, source: string | undefined): boolean {
  if (!source || !/\.[cm]?[jt]sx?$/.test(module)) return false
  const file = ts.createSourceFile(path.basename(module), source, ts.ScriptTarget.Latest, true)
  const handed = handedNames(file)
  const helpers = localFunctions(file)
  let owned = false
  const visit = (node: ts.Node): void => {
    if (owned) return
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(file)
      const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      if (expression && HANDLER_ATTRIBUTE.test(name) && reachesPast(expression, handed, helpers, 0)) owned = true
      else if (expression && ADDRESS_ATTRIBUTES.has(name) && isNavigation(node) && namesOwnAddress(expression, handed)) owned = true
    } else if (
      ts.isPropertyAssignment(node) &&
      ADDRESS_ATTRIBUTES.has(node.name.getText(file)) &&
      isAddressLiteral(unwrapped(node.initializer))
    ) {
      owned = true
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return owned
}

/**
 * The names a component was handed or holds as local UI state: its parameters
 * (destructured props, a `props` object, a rest binding), the setter a
 * `useState`/`useReducer` returns, and a ref (`useRef`/`createRef`) to one of
 * its own elements.
 */
function handedNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text)
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBinding(element.name)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) for (const parameter of node.parameters) addBinding(parameter.name)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      LOCAL_STATE_HOOKS.has(calleeName(node.initializer.expression))
    ) {
      const setter = node.name.elements[1]
      if (setter && !ts.isOmittedExpression(setter)) addBinding(setter.name)
    }
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      LOCAL_REF_CALLS.has(calleeName(node.initializer.expression))
    ) {
      addBinding(node.name)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

/**
 * The component's own named functions, by name: `const handleDelete = () => …`,
 * `function toggle() {…}`, and one a hook wraps (`const toggle =
 * useCallback(() => …, [])`, a `useMemo` factory).
 */
function localFunctions(file: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>()
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) functions.set(node.name.text, node.body)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const declared = wrappedFunction(node.initializer)
      if (declared) functions.set(node.name.text, declared.body)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return functions
}

/** The function an initializer declares: itself, or the one a `useCallback`/`useMemo` is handed. */
function wrappedFunction(initializer: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const expression = unwrapped(initializer)
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression
  if (!ts.isCallExpression(expression) || !FUNCTION_WRAPPING_HOOKS.has(calleeName(expression.expression))) return undefined
  const [handed] = expression.arguments
  return handed && (ts.isArrowFunction(handed) || ts.isFunctionExpression(handed)) ? handed : undefined
}

/** A callee's own name: `useState` for both `useState(…)` and `React.useState(…)`; empty for any other callee. */
function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : ''
}

/** An expression with its casts and parentheses taken off: `toggleModal as Handler` is `toggleModal`. */
function unwrapped(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/** The identifier a call or reference starts from: `toggleModal` in `toggleModal()`, `props` in `props.onChange(v)`. */
function rootName(expression: ts.Expression): string | undefined {
  let current = unwrapped(expression)
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = unwrapped(current.expression)
  }
  return ts.isIdentifier(current) ? current.text : undefined
}

/**
 * Does a handler expression reach past what the component was handed? A bare
 * reference is judged by its root name; a function body by every call in it;
 * a local helper by its own body, a few levels deep.
 */
function reachesPast(node: ts.Node, handed: Set<string>, helpers: Map<string, ts.Node>, depth: number): boolean {
  const judge = (name: string | undefined): boolean => {
    if (name === undefined || handed.has(name)) return false
    const helper = helpers.get(name)
    if (helper) return depth < MAX_HELPER_DEPTH && reachesPast(helper, handed, helpers, depth + 1)
    return true
  }
  const bare = ts.isExpression(node) ? unwrapped(node) : node
  if (ts.isIdentifier(bare) || ts.isPropertyAccessExpression(bare) || ts.isElementAccessExpression(bare)) {
    return judge(rootName(bare))
  }
  let reached = false
  const visit = (child: ts.Node): void => {
    if (reached) return
    if (ts.isCallExpression(child) && judge(rootName(child.expression))) reached = true
    else ts.forEachChild(child, visit)
  }
  visit(node)
  return reached
}

/**
 * Does this address attribute navigate? On a component (`Link`, a sidebar's
 * own link wrapper) it does; on a plain element only an `a` does, so a
 * `<link href>` in the document head is not a navigation.
 */
function isNavigation(attribute: ts.JsxAttribute): boolean {
  const element = attribute.parent.parent
  if (!ts.isJsxOpeningElement(element) && !ts.isJsxSelfClosingElement(element)) return false
  const tag = element.tagName.getText()
  return tag === 'a' || !/^[a-z]/.test(tag)
}

/**
 * A literal that reads as an address: `"/settings"`, `` `/tags/${id}` ``,
 * `"https://…"`, `"mailto:…"`. A literal that does not start like one
 * (`{ to: "Friday" }`) is some other value named `to`.
 */
function isAddressLiteral(expression: ts.Expression): boolean {
  const text = ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : ts.isTemplateExpression(expression)
      ? expression.head.text
      : undefined
  return text !== undefined && ADDRESS_PREFIXES.some((prefix) => text.startsWith(prefix))
}

/** Does an `href` name an address of the component's own, rather than one it was handed? */
function namesOwnAddress(expression: ts.Expression, handed: Set<string>): boolean {
  if (isAddressLiteral(unwrapped(expression))) return true
  const name = rootName(expression)
  return name !== undefined && !handed.has(name)
}

/** `component-link-actions-1a2b3c4d` for `apps/web/components/LinkActions.tsx`. */
export function sharedComponentId(module: string): string {
  const slug = componentName(module)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const hash = createHash('sha256').update(module).digest('hex').slice(0, 8)
  return `component-${slug ? `${slug}-` : ''}${hash}`
}

/** The component's name: its file's base name, or its folder's when the file is an `index`. */
function componentName(module: string): string {
  const base = path.basename(module, path.extname(module))
  return base === 'index' ? path.basename(path.dirname(module)) : base
}
