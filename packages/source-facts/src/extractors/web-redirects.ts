import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { SupportedLanguage, WebRedirect } from '@truecourse/shared'
import { stringLiteral, walk } from './outbound-requests.js'

// ---------------------------------------------------------------------------
// Redirects — the addresses that exist and are still nowhere to stand
//
// A place is an address whose module RENDERS, and the routing readers cannot
// see the two idioms that keep an address alive while making it unreachable:
//
//  1. A CONFIG TABLE. cal.diy's `/bookings` is a real Next.js address with no
//     `page.tsx` behind it — `next.config.ts` answers it with a permanent
//     redirect to `/bookings/upcoming`, and nothing in the route tree says so.
//
//  2. A MODULE THAT ONLY REDIRECTS. documenso's `dashboard.tsx` exports a
//     `loader` whose entire body is `throw redirect('/documents')` — and a full
//     page component behind it that no visitor ever reaches. The exports gate
//     sees the default export and calls it a screen.
//
// Both are worth exactly one authoring session each, spent on a screen nobody
// can open. WHAT IS DELIBERATELY NOT READ is the conditional form: documenso's
// `certificate.tsx` redirects when a feature flag is off and renders otherwise,
// so a rule that cannot tell the two apart would delete real screens. Hence the
// two gates below — a config entry drops nothing when it carries `has`
// conditions, and a module drops nothing when its redirect has a statement
// beside it.
//
// JS/TS ONLY. No other language in the analyzer has a web-routing idiom these
// facts belong to; Python and C# contribute nothing, which reads as "not looked
// at" and never as "redirects nothing".
// ---------------------------------------------------------------------------

/** What one file yields: its config table, and whether the module itself is a redirect. */
export interface WebRedirectExtraction {
  /** The config table's literal entries — empty for every file that is not one. */
  redirects: WebRedirect[]
  /** Whether this module's `loader` / default export does nothing but redirect. */
  redirectsUnconditionally: boolean
}

const EMPTY: WebRedirectExtraction = { redirects: [], redirectsUnconditionally: false }

/** The languages a web module is written in. */
const WEB_LANGUAGES = new Set<SupportedLanguage>(['typescript', 'tsx', 'javascript'])

/** The config filenames Next.js accepts — the same set the mapper reads an app root from. */
const NEXT_CONFIG = /^next\.config\.(?:js|mjs|cjs|ts|mts)$/

/** The config property whose function returns the redirect table. `rewrites` has
 *  the identical shape and means the opposite, so the name is the whole gate. */
const REDIRECT_TABLE = 'redirects'

/** The exports whose redirect settles the module. A route module's `loader` runs
 *  before anything renders, so a redirect there is the module's whole behaviour
 *  however much component code sits below it. */
const LOADER_EXPORTS = new Set(['loader', 'clientLoader'])

/**
 * The redirect facts of one file: the entries its framework config declares, and
 * whether the module itself is nothing but a redirect.
 */
export function extractWebRedirects(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): WebRedirectExtraction {
  if (!WEB_LANGUAGES.has(language)) return EMPTY
  return {
    redirects: isNextConfig(filePath) ? configRedirects(tree) : [],
    redirectsUnconditionally: moduleOnlyRedirects(tree),
  }
}

function isNextConfig(filePath: string): boolean {
  const cut = filePath.lastIndexOf('/')
  return NEXT_CONFIG.test(filePath.slice(cut + 1))
}

/**
 * The literal entries of the config's `redirects()` table. Read as "every object
 * with a `source` and a `destination` inside the table's function", because the
 * table is written as a `return [...]` whose array can be assembled behind a
 * `map`, a spread or an environment check — a structural reading of the return
 * expression would refuse cal.diy's config outright, and the name gate above is
 * what makes the loose reading safe.
 */
function configRedirects(tree: Tree): WebRedirect[] {
  const entries: WebRedirect[] = []
  walk(tree.rootNode, (node) => {
    if (!isRedirectTable(node)) return
    walk(node, (inner) => {
      if (inner.type !== 'object') return
      const entry = redirectEntry(inner)
      if (entry) entries.push(entry)
    })
  })
  return entries
}

/** `async redirects() {}` / `redirects: async () => []` — the property, not its value. */
function isRedirectTable(node: SyntaxNode): boolean {
  if (node.type === 'method_definition') {
    return propertyName(node.childForFieldName('name')) === REDIRECT_TABLE
  }
  if (node.type !== 'pair') return false
  if (propertyName(node.childForFieldName('key')) !== REDIRECT_TABLE) return false
  const value = node.childForFieldName('value')
  return value?.type === 'arrow_function' || value?.type === 'function_expression'
}

/** One table entry, or `null` when the object is not one (a `has` condition, a
 *  header rule) or states its addresses in anything but literals. */
function redirectEntry(object: SyntaxNode): WebRedirect | null {
  let source: string | null = null
  let destination: string | null = null
  let permanent: boolean | undefined
  let conditional = false

  for (const pair of object.namedChildren) {
    if (!pair || pair.type !== 'pair') continue
    const key = propertyName(pair.childForFieldName('key'))
    const value = pair.childForFieldName('value')
    if (!key || !value) continue
    if (key === 'source') source = stringLiteral(value)
    else if (key === 'destination') destination = stringLiteral(value)
    else if (key === 'permanent') permanent = booleanLiteral(value)
    else if (key === 'has' || key === 'missing') conditional = true
  }

  if (source === null || destination === null) return null
  return {
    source,
    destination,
    ...(permanent === undefined ? {} : { permanent }),
    ...(conditional ? { conditional } : {}),
  }
}

/** A property key's name, quoted (`'source'`) or bare (`source`). */
function propertyName(key: SyntaxNode | null): string | null {
  if (!key) return null
  return stringLiteral(key) ?? key.text
}

function booleanLiteral(node: SyntaxNode): boolean | undefined {
  if (node.type === 'true') return true
  if (node.type === 'false') return false
  return undefined
}

/**
 * Whether an export that decides what this module DOES is one redirect and
 * nothing else. One statement is the whole gate: a body with anything beside the
 * redirect is a module that chooses, and a module that chooses renders for
 * somebody.
 */
function moduleOnlyRedirects(tree: Tree): boolean {
  for (const statement of tree.rootNode.namedChildren) {
    if (!statement || statement.type !== 'export_statement') continue
    for (const fn of decidingExports(statement)) {
      if (bodyIsOneRedirect(fn)) return true
    }
  }
  return false
}

/**
 * The functions of one export statement whose behaviour IS the module's: a
 * route's `loader`, and the default export (a page module is its default
 * export). Anything else the module exports is a helper.
 */
function decidingExports(statement: SyntaxNode): SyntaxNode[] {
  const isDefault = statement.children.some((child) => child.type === 'default')
  const functions: SyntaxNode[] = []

  const declaration = statement.childForFieldName('declaration')
  if (declaration?.type === 'function_declaration' || declaration?.type === 'generator_function_declaration') {
    const name = declaration.childForFieldName('name')?.text
    if (isDefault || (name !== undefined && LOADER_EXPORTS.has(name))) functions.push(declaration)
  } else if (declaration?.type === 'lexical_declaration' || declaration?.type === 'variable_declaration') {
    for (const declarator of declaration.namedChildren) {
      if (!declarator || declarator.type !== 'variable_declarator') continue
      const name = declarator.childForFieldName('name')?.text
      const value = declarator.childForFieldName('value')
      if (value && name !== undefined && LOADER_EXPORTS.has(name)) functions.push(value)
    }
  }

  // `export default <expression>` — the value form, which the grammar keeps in
  // its own field: an anonymous `function () {}` or an arrow.
  const value = statement.childForFieldName('value')
  if (isDefault && value) functions.push(value)

  return functions
}

/** A function whose entire body is `throw redirect(…)` / `return redirect(…)` /
 *  `redirect(…)` — the last being how a Next page writes it, since `redirect()`
 *  throws on its own and the page renders nothing either way. */
function bodyIsOneRedirect(fn: SyntaxNode): boolean {
  if (!FUNCTION_NODES.has(fn.type)) return false
  const body = fn.childForFieldName('body')
  if (!body) return false
  if (body.type !== 'statement_block') return isRedirectCall(body)

  const statements = body.namedChildren.filter((child) => child && child.type !== 'comment')
  const only = statements.length === 1 ? statements[0] : undefined
  if (!only) return false
  if (!ONE_REDIRECT_STATEMENTS.has(only.type)) return false
  const expression = only.namedChildren.find((child) => child && child.type !== 'comment')
  return expression ? isRedirectCall(expression) : false
}

const FUNCTION_NODES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_expression',
  'arrow_function',
])

/** The statements a lone redirect is written as. A `return` is included because
 *  remix's `redirect()` builds a Response the loader returns. */
const ONE_REDIRECT_STATEMENTS = new Set(['throw_statement', 'return_statement', 'expression_statement'])

/** `redirect(…)`, bare or namespaced, awaited or not. */
function isRedirectCall(node: SyntaxNode): boolean {
  if (node.type === 'await_expression') {
    const awaited = node.namedChild(0)
    return awaited ? isRedirectCall(awaited) : false
  }
  if (node.type !== 'call_expression') return false
  const callee = node.childForFieldName('function')
  if (!callee) return false
  if (callee.type === 'member_expression') return callee.childForFieldName('property')?.text === 'redirect'
  return callee.text === 'redirect'
}
