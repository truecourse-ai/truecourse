/**
 * CLI command extraction — the command/flag tree a JS/TS program registers with
 * commander or yargs, read straight from the framework's call signatures. The
 * artifact is the cli surface's structural map (which commands exist, how they
 * nest, which flags each accepts), the analyzer analogue of `routeRegistrations`
 * for HTTP.
 *
 * Nesting is resolved the way `routerMounts` resolves routers: command objects
 * are tracked through the VARIABLES they are assigned to, so
 * `const specCmd = program.command('spec')` followed by `specCmd.command('docs')`
 * yields the path `["spec","docs"]` — to any depth, and across the whole file
 * regardless of declaration order.
 *
 * Python (click/argparse) and C# (System.CommandLine) have no extractor yet: they
 * return an empty list, never an error.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { CliCommand, CliCommandFlag, SourceLocation, SupportedLanguage } from '@truecourse/shared'

/** Methods that declare a flag on the command they are chained onto. */
const OPTION_METHODS = new Set(['option', 'requiredOption', 'options', 'addOption'])
/** Methods carrying a command's one-line description (commander + yargs spellings). */
const DESCRIPTION_METHODS = new Set(['description', 'summary'])
/** Methods carrying a command's handler. */
const HANDLER_METHODS = new Set(['action', 'handler'])

/** A command word: what a user types. Rejects yargs' `$0` / `*` default markers. */
const COMMAND_WORD = /^[A-Za-z0-9][\w:.-]*$/

/**
 * Which framework a chain belongs to. The two disagree on what `.command()`
 * RETURNS, and that is what decides nesting: commander returns the NEW subcommand
 * (so `.command('a').command('b')` nests `b` under `a`) except in its two-string
 * executable form, which returns the parent; yargs always returns the same
 * instance, and nests only inside a builder callback.
 */
type FrameworkKind = 'commander' | 'yargs'

/** What an expression evaluates to: a command object at `path`, in `kind`'s dialect. */
interface CommandRef {
  path: string[]
  kind: FrameworkKind
}

/** Identifier → the command it refers to (module scope, plus builder scopes). */
type Scope = Map<string, CommandRef>

/** Map key for a command path — a command word never contains a space. */
function pathKey(path: readonly string[]): string {
  return path.join(' ')
}

export function extractCliCommands(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): CliCommand[] {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return extractJsCliCommands(tree, filePath)
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// Framework bindings
// ---------------------------------------------------------------------------

/** What the file imported: the identifiers that can start a command chain. */
interface FrameworkBindings {
  /** True when commander or yargs is imported at all — the extractor's gate. */
  present: boolean
  /** Identifiers bound to commander's `Command` class (`new Command()` is a root). */
  commandClasses: Set<string>
  /** Identifiers that ARE a root program (commander's `program`, a yargs singleton). */
  roots: Map<string, FrameworkKind>
  /** Commander namespace identifiers (`commander.program`, `new commander.Command()`). */
  namespaces: Set<string>
  /** Identifiers bound to a yargs factory (`yargs(hideBin(argv))` is a root). */
  yargsFactories: Set<string>
}

function isCommanderModule(source: string): boolean {
  return source === 'commander' || source.startsWith('commander/')
}

function isYargsModule(source: string): boolean {
  return source === 'yargs' || source === 'yargs/yargs'
}

/**
 * Collect the framework identifiers from imports and `require` calls. Everything
 * downstream is gated on these, so an unrelated object with a `.command()` method
 * never produces a command.
 */
function detectBindings(tree: Tree): FrameworkBindings {
  const bindings: FrameworkBindings = {
    present: false,
    commandClasses: new Set(),
    roots: new Map(),
    namespaces: new Set(),
    yargsFactories: new Set(),
  }

  const visit = (node: SyntaxNode): void => {
    if (node.type === 'import_statement') readImport(node, bindings)
    else if (node.type === 'variable_declarator') readRequire(node, bindings)
    for (const child of node.namedChildren) if (child) visit(child)
  }
  visit(tree.rootNode)
  return bindings
}

function readImport(node: SyntaxNode, bindings: FrameworkBindings): void {
  const source = stringLiteral(node.childForFieldName('source'))
  if (!source) return
  const commander = isCommanderModule(source)
  const yargs = isYargsModule(source)
  // `yargs/helpers` (hideBin) marks yargs usage but binds nothing.
  if (!commander && !yargs && !source.startsWith('yargs/')) return
  bindings.present = true

  const clause = node.namedChildren.find((c) => c?.type === 'import_clause')
  if (!clause) return
  for (const child of clause.namedChildren) {
    if (!child) continue
    if (child.type === 'identifier') {
      bindDefaultImport(bindings, child.text, commander, yargs)
    } else if (child.type === 'namespace_import') {
      const name = child.namedChildren.find((c) => c?.type === 'identifier')?.text
      if (name) bindDefaultImport(bindings, name, commander, yargs)
    } else if (child.type === 'named_imports') {
      for (const spec of child.namedChildren) {
        if (!spec || spec.type !== 'import_specifier') continue
        const imported = spec.childForFieldName('name')?.text
        const local = spec.childForFieldName('alias')?.text ?? imported
        if (imported && local) bindNamedImport(bindings, imported, local, commander, yargs)
      }
    }
  }
}

/** A default/namespace import: commander's module object, or the yargs factory. */
function bindDefaultImport(
  bindings: FrameworkBindings,
  local: string,
  commander: boolean,
  yargs: boolean,
): void {
  if (commander) bindings.namespaces.add(local)
  if (yargs) {
    bindings.yargsFactories.add(local)
    bindings.roots.set(local, 'yargs')
  }
}

function bindNamedImport(
  bindings: FrameworkBindings,
  imported: string,
  local: string,
  commander: boolean,
  yargs: boolean,
): void {
  if (commander) {
    if (imported === 'Command') bindings.commandClasses.add(local)
    else if (imported === 'program') bindings.roots.set(local, 'commander')
  }
  if (yargs && imported === 'default') bindDefaultImport(bindings, local, false, true)
}

/** `const { Command } = require('commander')`, `const y = require('yargs')`, … */
function readRequire(node: SyntaxNode, bindings: FrameworkBindings): void {
  const value = node.childForFieldName('value')
  const name = node.childForFieldName('name')
  if (!value || !name) return

  // `require('commander').program` / `require('commander').Command`
  if (value.type === 'member_expression') {
    const source = requiredModule(value.childForFieldName('object'))
    const property = value.childForFieldName('property')?.text
    if (!source || !property || name.type !== 'identifier') return
    bindings.present = true
    if (isCommanderModule(source)) bindNamedImport(bindings, property, name.text, true, false)
    return
  }

  const source = requiredModule(value)
  if (!source) return
  const commander = isCommanderModule(source)
  const yargs = isYargsModule(source)
  if (!commander && !yargs) return
  bindings.present = true

  if (name.type === 'identifier') {
    bindDefaultImport(bindings, name.text, commander, yargs)
  } else if (name.type === 'object_pattern') {
    for (const prop of name.namedChildren) {
      if (!prop) continue
      if (prop.type === 'shorthand_property_identifier_pattern') {
        bindNamedImport(bindings, prop.text, prop.text, commander, yargs)
      } else if (prop.type === 'pair_pattern') {
        const key = prop.childForFieldName('key')?.text
        const local = prop.childForFieldName('value')?.text
        if (key && local) bindNamedImport(bindings, key, local, commander, yargs)
      }
    }
  }
}

/** The module string of a `require('x')` call, or null. */
function requiredModule(node: SyntaxNode | null): string | null {
  if (!node || node.type !== 'call_expression') return null
  if (node.childForFieldName('function')?.text !== 'require') return null
  const arg = node.childForFieldName('arguments')?.namedChild(0)
  return stringLiteral(arg ?? null)
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface CommandDraft {
  name: string
  path: string[]
  kind?: FrameworkKind
  location: SourceLocation | null
  description?: string
  handlerName?: string
  /** Flags with their source offset — a fluent chain is walked outermost-first,
   *  so they are re-sorted into declaration order at emit. */
  flags: (CliCommandFlag & { offset: number })[]
  flagKeys: Set<string>
  /** A commander `.version(…)` call on this command: its custom flag spec and
   *  description when passed, and where the call sits. */
  version?: { spec?: string; description?: string; offset: number }
  /** A commander `.helpOption(flags, desc)` customization on this command. */
  help?: { spec: string; description?: string }
  /** `.helpOption(false)`: commander generates no help flag for this command. */
  helpDisabled?: boolean
}

function extractJsCliCommands(tree: Tree, filePath: string): CliCommand[] {
  const bindings = detectBindings(tree)
  if (!bindings.present) return []

  const varRefs = resolveVariables(tree, bindings)
  const literals: LiteralContext = {
    factories: collectOptionFactories(tree),
    arrayConsts: collectStringArrayConsts(tree),
  }
  const drafts = new Map<string, CommandDraft>()
  // Whether any subcommand is registered on a commander program, which is what
  // makes the program itself (path `[]`) an invocable surface worth emitting.
  let commanderSubcommands = false

  const draftFor = (path: string[], kind?: FrameworkKind): CommandDraft => {
    const key = pathKey(path)
    let draft = drafts.get(key)
    if (!draft) {
      draft = { name: path[path.length - 1] ?? '', path, location: null, flags: [], flagKeys: new Set() }
      drafts.set(key, draft)
    }
    if (kind) draft.kind ??= kind
    return draft
  }

  /** The root has no `.command(…)` call of its own; its first program-level
   *  registration is where it is "declared". */
  const touchRoot = (ref: CommandRef, node: SyntaxNode): CommandDraft => {
    const draft = draftFor(ref.path, ref.kind)
    if (ref.path.length === 0) draft.location ??= commandCallLocation(node, filePath)
    return draft
  }

  const resolveIn = (node: SyntaxNode | null, scope: Scope): CommandRef | null =>
    resolveRef(node, scope, varRefs, bindings)

  const visit = (node: SyntaxNode, scope: Scope): void => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      const property = callee?.type === 'member_expression'
        ? callee.childForFieldName('property')?.text ?? ''
        : ''
      const receiver = callee?.type === 'member_expression' ? callee.childForFieldName('object') : null

      if (property === 'command' && callee) {
        const parent = resolveIn(receiver, scope)
        const name = commandName(node)
        if (parent && name) {
          if (parent.kind === 'commander') commanderSubcommands = true
          const path = [...parent.path, name]
          const draft = draftFor(path, parent.kind)
          if (!draft.location) draft.location = commandCallLocation(node, filePath)
          applyInlineArgs(draft, node, parent.kind)
          // Only the ARGUMENTS see the builder binding (yargs' `(y) => y.command(…)`);
          // the callee chain keeps the enclosing scope.
          const inner = parent.kind === 'yargs' ? builderScope(node, scope, path) : scope
          const args = node.childForFieldName('arguments')
          if (args) for (const arg of args.namedChildren) if (arg) visit(arg, inner)
          visit(callee, scope)
          return
        }
      } else if (callee?.type === 'member_expression') {
        if (OPTION_METHODS.has(property)) {
          const ref = resolveIn(receiver, scope)
          if (ref) addFlags(touchRoot(ref, node), property, node, literals)
        } else if (DESCRIPTION_METHODS.has(property)) {
          const ref = resolveIn(receiver, scope)
          const args = node.childForFieldName('arguments')
          const text = args?.namedChildCount === 1 ? stringLiteral(args.namedChild(0)) : null
          if (ref && text) touchRoot(ref, node).description ??= text
        } else if (HANDLER_METHODS.has(property)) {
          const ref = resolveIn(receiver, scope)
          const handler = handlerName(node.childForFieldName('arguments')?.namedChild(0) ?? null)
          if (ref && handler) touchRoot(ref, node).handlerName ??= handler
        } else if (property === 'version') {
          const ref = resolveIn(receiver, scope)
          const args = node.childForFieldName('arguments')
          // A `.version('1.2.3')` SETTER only; commander's zero-argument form reads.
          if (ref && ref.kind === 'commander' && args && args.namedChildCount > 0) {
            const spec = stringLiteral(args.namedChild(1))
            const description = stringLiteral(args.namedChild(2))
            touchRoot(ref, node).version ??= {
              ...(spec ? { spec } : {}),
              ...(description ? { description } : {}),
              offset: args.startIndex,
            }
          }
        } else if (property === 'helpOption') {
          const ref = resolveIn(receiver, scope)
          const args = node.childForFieldName('arguments')
          const first = args?.namedChild(0)
          if (ref && ref.kind === 'commander' && first) {
            const draft = touchRoot(ref, node)
            if (first.text === 'false') {
              draft.helpDisabled = true
            } else {
              const spec = stringLiteral(first)
              const desc = stringLiteral(args?.namedChild(1) ?? null)
              if (spec) draft.help ??= { spec, ...(desc ? { description: desc } : {}) }
            }
          }
        }
      }
    }

    for (const child of node.namedChildren) if (child) visit(child, scope)
  }

  visit(tree.rootNode, new Map())

  finalizeRoot(drafts, commanderSubcommands)

  return [...drafts.values()]
    .filter((d): d is CommandDraft & { location: SourceLocation } => d.location !== null)
    .sort(
      (a, b) =>
        a.location.startLine - b.location.startLine ||
        a.location.startColumn - b.location.startColumn ||
        a.path.length - b.path.length,
    )
    .map((d) => ({
      name: d.name,
      path: d.path,
      flags: [...d.flags]
        .sort((a, b) => a.offset - b.offset)
        .map(({ offset: _offset, ...flag }) => flag),
      ...(d.description ? { description: d.description } : {}),
      ...(d.handlerName ? { handlerName: d.handlerName } : {}),
      location: d.location,
    }))
}

/**
 * Whether the program itself (path `[]`) is emitted, and with which generated
 * flags. The root is a command when it carries program-level flags, declares a
 * version, or (on commander) registers any subcommand; a root draft touched
 * only by a description or handler is dropped. Commander generates `--version`
 * (behind `.version(…)`) and `--help` (always, unless `.helpOption(false)`), so
 * an emitted commander root carries both as `synthesized` flags.
 */
function finalizeRoot(drafts: Map<string, CommandDraft>, commanderSubcommands: boolean): void {
  let root = drafts.get('')
  if (!root && commanderSubcommands) {
    root = { name: '', path: [], kind: 'commander', location: null, flags: [], flagKeys: new Set() }
    drafts.set('', root)
  }
  if (!root) return

  const qualifies =
    root.flags.length > 0 ||
    root.version !== undefined ||
    (root.kind === 'commander' && commanderSubcommands)
  if (!qualifies) {
    drafts.delete('')
    return
  }

  if (root.kind === 'commander') {
    if (root.version) {
      pushFlag(root, root.version.spec ?? '--version', root.version.description ?? null, root.version.offset, {
        synthesized: true,
      })
    }
    if (!root.helpDisabled) {
      pushFlag(root, root.help?.spec ?? '-h, --help', root.help?.description ?? null, Number.MAX_SAFE_INTEGER, {
        synthesized: true,
      })
    }
  }

  // Declared where its first registration happens: a program-level call when one
  // exists, else the first subcommand declaration.
  if (!root.location) {
    const locations = [...drafts.values()]
      .map((d) => d.location)
      .filter((l): l is SourceLocation => l !== null)
      .sort((a, b) => a.startLine - b.startLine || a.startColumn - b.startColumn)
    root.location = locations[0] ?? null
  }
  if (!root.location) drafts.delete('')
}

/**
 * Module-scope variable → the command it holds, to a fixpoint so a command object
 * used before its declaration (or a chain of them) still resolves.
 */
function resolveVariables(tree: Tree, bindings: FrameworkBindings): Map<string, CommandRef> {
  const declarators: SyntaxNode[] = []
  const collect = (node: SyntaxNode): void => {
    if (node.type === 'variable_declarator') declarators.push(node)
    for (const child of node.namedChildren) if (child) collect(child)
  }
  collect(tree.rootNode)

  const varRefs = new Map<string, CommandRef>()
  const empty: Scope = new Map()
  for (let pass = 0; pass <= declarators.length; pass++) {
    let changed = false
    for (const declarator of declarators) {
      const name = declarator.childForFieldName('name')
      if (!name || name.type !== 'identifier' || varRefs.has(name.text)) continue
      const ref = resolveRef(declarator.childForFieldName('value'), empty, varRefs, bindings)
      if (!ref) continue
      varRefs.set(name.text, ref)
      changed = true
    }
    if (!changed) break
  }
  return varRefs
}

/**
 * The command an expression evaluates to, or null when it is not a command object.
 * A root program is the empty path; every fluent method other than `.command()`
 * returns the same object and is transparent (that is what makes
 * `program.command('x').description(…).option(…)` resolve to `["x"]`).
 */
function resolveRef(
  node: SyntaxNode | null,
  scope: Scope,
  varRefs: Map<string, CommandRef>,
  bindings: FrameworkBindings,
): CommandRef | null {
  if (!node) return null
  switch (node.type) {
    case 'parenthesized_expression':
    case 'await_expression':
    case 'non_null_expression':
    case 'as_expression':
    case 'satisfies_expression':
      return resolveRef(node.namedChild(0), scope, varRefs, bindings)
    case 'identifier': {
      const scoped = scope.get(node.text)
      if (scoped) return scoped
      const root = bindings.roots.get(node.text)
      if (root) return { path: [], kind: root }
      return varRefs.get(node.text) ?? null
    }
    case 'member_expression': {
      const object = node.childForFieldName('object')
      const property = node.childForFieldName('property')?.text
      if (property === 'program' && object?.type === 'identifier' && bindings.namespaces.has(object.text)) {
        return { path: [], kind: 'commander' }
      }
      return null
    }
    case 'new_expression': {
      const ctor = node.childForFieldName('constructor')
      if (!ctor) return null
      if (ctor.type === 'identifier' && bindings.commandClasses.has(ctor.text)) {
        return { path: [], kind: 'commander' }
      }
      if (ctor.type === 'member_expression') {
        const object = ctor.childForFieldName('object')
        const property = ctor.childForFieldName('property')?.text
        if (property === 'Command' && object?.type === 'identifier' && bindings.namespaces.has(object.text)) {
          return { path: [], kind: 'commander' }
        }
      }
      return null
    }
    case 'call_expression': {
      const callee = node.childForFieldName('function')
      if (!callee) return null
      if (callee.type === 'identifier') {
        return bindings.yargsFactories.has(callee.text) ? { path: [], kind: 'yargs' } : null
      }
      if (callee.type !== 'member_expression') return null
      const parent = resolveRef(callee.childForFieldName('object'), scope, varRefs, bindings)
      if (!parent) return null
      if (callee.childForFieldName('property')?.text !== 'command') return parent
      if (!descendsIntoCommand(node, parent.kind)) return parent
      const name = commandName(node)
      return name ? { path: [...parent.path, name], kind: parent.kind } : null
    }
    default:
      return null
  }
}

/**
 * Whether a `.command(…)` call RETURNS the declared subcommand (so the rest of the
 * chain configures it) or the parent. Yargs always returns the parent instance;
 * commander returns the parent only for its git-style executable form, where a
 * description is passed as the second argument instead of chained.
 */
function descendsIntoCommand(callNode: SyntaxNode, kind: FrameworkKind): boolean {
  if (kind === 'yargs') return false
  const second = callNode.childForFieldName('arguments')?.namedChild(1)
  return stringLiteral(second ?? null) === null
}

/**
 * Where a command is declared: the `command(…)` call site itself, from the method
 * name through its arguments. A whole fluent chain shares one start offset, so the
 * call node's own span would report every command in a chain at the same line.
 */
function commandCallLocation(callNode: SyntaxNode, filePath: string): SourceLocation {
  const callee = callNode.childForFieldName('function')
  const property = callee?.type === 'member_expression' ? callee.childForFieldName('property') : null
  const args = callNode.childForFieldName('arguments')
  const start = property ?? callNode
  const end = args ?? callNode
  return {
    filePath,
    startLine: start.startPosition.row + 1,
    startColumn: start.startPosition.column,
    endLine: end.endPosition.row + 1,
    endColumn: end.endPosition.column,
  }
}

/** The command word a `.command(…)` call declares, in any of its argument forms. */
function commandName(callNode: SyntaxNode): string | null {
  const first = callNode.childForFieldName('arguments')?.namedChild(0)
  return commandNameFromNode(first ?? null)
}

function commandNameFromNode(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'array') return commandNameFromNode(node.namedChild(0))
  if (node.type === 'object') return commandNameFromNode(pairValue(node, ['command']))
  const spec = stringLiteral(node)
  if (!spec) return null
  // The word ends at the first space (what follows are argument placeholders);
  // `'rm|remove'` declares an inline alias, of which the first is the name.
  const head = spec.trim().split(/\s+/)[0]?.split('|')[0] ?? ''
  return COMMAND_WORD.test(head) ? head : null
}

/**
 * The description/handler a `.command(…)` call passes INLINE rather than through a
 * chained method: commander's and yargs' second string argument, yargs' fourth
 * positional handler, and the yargs object form's `describe`/`handler` keys.
 */
function applyInlineArgs(draft: CommandDraft, callNode: SyntaxNode, kind: FrameworkKind): void {
  const args = callNode.childForFieldName('arguments')
  if (!args) return
  const first = args.namedChild(0)
  if (first?.type === 'object') {
    const describe = stringLiteral(pairValue(first, ['describe', 'desc', 'description']))
    if (describe) draft.description ??= describe
    const handler = handlerName(pairValue(first, ['handler']))
    if (handler) draft.handlerName ??= handler
    return
  }

  const second = stringLiteral(args.namedChild(1))
  if (second) draft.description ??= second

  // yargs positional signature: (cmd, describe, builder, handler).
  if (kind !== 'yargs') return
  for (let i = args.namedChildCount - 1; i >= 3; i--) {
    const handler = handlerName(args.namedChild(i))
    if (handler) {
      draft.handlerName ??= handler
      return
    }
  }
}

/**
 * The scope a yargs command's BUILDER sees: its first parameter is the yargs
 * instance scoped to that command, so `.command('users', 'd', (y) => y.command('add'))`
 * nests `add` under `users`. Only the builder position binds — the handler that
 * may follow it takes parsed argv, not a command object.
 */
function builderScope(callNode: SyntaxNode, scope: Scope, path: string[]): Scope {
  const args = callNode.childForFieldName('arguments')
  if (!args) return scope
  const first = args.namedChild(0)
  const builder = first?.type === 'object' ? pairValue(first, ['builder']) : args.namedChild(2)
  if (!builder || !isFunctionNode(builder)) return scope
  const param = firstParameterName(builder)
  if (!param) return scope
  const next: Scope = new Map(scope)
  next.set(param, { path, kind: 'yargs' })
  return next
}

function isFunctionNode(node: SyntaxNode): boolean {
  return (
    node.type === 'arrow_function' ||
    node.type === 'function_expression' ||
    node.type === 'function' ||
    node.type === 'function_declaration'
  )
}

function firstParameterName(fn: SyntaxNode): string | null {
  const single = fn.childForFieldName('parameter')
  if (single?.type === 'identifier') return single.text
  const params = fn.childForFieldName('parameters')
  const first = params?.namedChild(0)
  if (!first) return null
  if (first.type === 'identifier') return first.text
  const pattern = first.childForFieldName('pattern')
  return pattern?.type === 'identifier' ? pattern.text : null
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** What a declaration says about a flag beyond its name and one-liner. */
type FlagFacts = Pick<CliCommandFlag, 'required' | 'takesValue' | 'valueHint' | 'choices' | 'synthesized'>

/**
 * The module-scope literals flag declarations resolve through: option FACTORIES
 * (`.addOption(llmTransportOption())`, a function returning an Option builder
 * chain) and string-array consts (`.choices([...LLM_PROVIDER_KINDS])`).
 */
interface LiteralContext {
  /** Function name → the single expression its body returns. */
  factories: Map<string, SyntaxNode>
  /** Const name → its string-literal array value. */
  arrayConsts: Map<string, string[]>
}

function addFlags(
  draft: CommandDraft,
  method: string,
  callNode: SyntaxNode,
  literals: LiteralContext,
): void {
  const args = callNode.childForFieldName('arguments')
  if (!args) return
  const first = args.namedChild(0)
  if (!first) return
  // The ARGUMENT list's offset, not the call's: every call in a fluent chain starts
  // at the same receiver, while its arguments advance with the declaration order.
  const offset = args.startIndex
  // `requiredOption` says the command refuses to run without the flag.
  const required: FlagFacts = method === 'requiredOption' ? { required: true } : {}

  if (method === 'addOption') {
    // `addOption(new Option('--json', 'desc'))`, and the same construction with the
    // builder chained onto it (`.choices([…]).default('x')`).
    const builder = readOptionBuilder(first, literals, new Set())
    if (!builder) return
    const optionArgs = builder.construction.childForFieldName('arguments')
    pushFlag(
      draft,
      stringLiteral(optionArgs?.namedChild(0) ?? null),
      stringLiteral(optionArgs?.namedChild(1) ?? null),
      offset,
      builder.facts,
    )
    return
  }

  if (first.type === 'object') {
    // yargs map form: `.options({ verbose: { describe: '…' }, … })`
    for (const pair of first.namedChildren) {
      if (!pair || pair.type !== 'pair') continue
      const key = propertyName(pair.childForFieldName('key'))
      const value = pair.childForFieldName('value')
      const describe = value?.type === 'object'
        ? stringLiteral(pairValue(value, ['describe', 'desc', 'description']))
        : null
      pushFlag(draft, key, describe, pair.startIndex, value?.type === 'object' ? yargsFacts(value, literals) : {})
    }
    return
  }

  const spec = stringLiteral(first)
  if (!spec) return
  const second = args.namedChild(1)
  const describe = second?.type === 'object'
    ? stringLiteral(pairValue(second, ['describe', 'desc', 'description']))
    : stringLiteral(second ?? null)
  const options = second?.type === 'object' ? yargsFacts(second, literals) : {}
  pushFlag(draft, spec, describe, offset, { ...options, ...required })
}

function pushFlag(
  draft: CommandDraft,
  spec: string | null,
  description: string | null,
  offset: number,
  facts: FlagFacts = {},
): void {
  const flag = canonicalFlag(spec)
  if (!flag || draft.flagKeys.has(flag)) return
  draft.flagKeys.add(flag)
  draft.flags.push({
    flag,
    ...(description ? { description } : {}),
    // The spec's own placeholder, unless the declaration form already stated one.
    ...valueFacts(spec),
    ...facts,
    offset,
  })
}

/** A commander `new Option(…)` construction plus what its builder chain declared. */
interface OptionBuilder {
  construction: SyntaxNode
  facts: FlagFacts
}

/**
 * The `new Option(…)` behind an `addOption` argument. Commander's option builder is
 * FLUENT (`new Option('--transport <mode>', 'd').choices([…]).default('api')`), so
 * the argument is a call expression whose receiver chain ends at the construction —
 * reading only `new_expression` dropped every configured option, which is most of
 * the ones worth having. A bare `factory()` call resolves through the module-scope
 * function's returned expression (`seen` breaks factory-calls-factory cycles).
 */
function readOptionBuilder(
  node: SyntaxNode | null,
  literals: LiteralContext,
  seen: Set<string>,
): OptionBuilder | null {
  if (!node) return null
  switch (node.type) {
    case 'parenthesized_expression':
    case 'non_null_expression':
    case 'as_expression':
    case 'satisfies_expression':
      return readOptionBuilder(node.namedChild(0), literals, seen)
    case 'new_expression':
      return { construction: node, facts: {} }
    case 'call_expression': {
      const callee = node.childForFieldName('function')
      if (callee?.type === 'identifier') {
        const factory = literals.factories.get(callee.text)
        if (!factory || seen.has(callee.text)) return null
        seen.add(callee.text)
        return readOptionBuilder(factory, literals, seen)
      }
      if (callee?.type !== 'member_expression') return null
      const inner = readOptionBuilder(callee.childForFieldName('object'), literals, seen)
      if (!inner) return null
      applyBuilderMethod(inner, callee.childForFieldName('property')?.text ?? '', node, literals)
      return inner
    }
    default:
      return null
  }
}

/** What one chained builder method states about the option it configures. */
function applyBuilderMethod(
  builder: OptionBuilder,
  method: string,
  callNode: SyntaxNode,
  literals: LiteralContext,
): void {
  const args = callNode.childForFieldName('arguments')
  if (method === 'choices') {
    const choices = stringArray(args?.namedChild(0) ?? null, literals)
    if (choices) builder.facts.choices ??= choices
  } else if (method === 'makeOptionMandatory') {
    // The single argument, when present, is the boolean it sets.
    const explicit = args?.namedChild(0)?.text
    builder.facts.required ??= explicit !== 'false'
  }
}

/** The yargs option-object facts: its closed value set and whether it is demanded. */
function yargsFacts(objectNode: SyntaxNode, literals: LiteralContext): FlagFacts {
  const facts: FlagFacts = {}
  const choices = stringArray(pairValue(objectNode, ['choices']), literals)
  if (choices) facts.choices = choices
  const demanded = pairValue(objectNode, ['demandOption', 'demand', 'require', 'required'])?.text
  if (demanded === 'true') facts.required = true
  return facts
}

/**
 * Every string of an array literal, or null when any element is not resolvable.
 * A spread of a module-scope const (`[...LLM_PROVIDER_KINDS]`) splices the
 * const's own string literals in; a spread of anything else (an import, a call)
 * stays unresolvable and nulls the whole list.
 */
function stringArray(node: SyntaxNode | null, literals: LiteralContext): string[] | null {
  if (!node || node.type !== 'array') return null
  const values: string[] = []
  for (const element of node.namedChildren) {
    if (!element) continue
    if (element.type === 'spread_element') {
      const inner = element.namedChild(0)
      const resolved = inner?.type === 'identifier' ? literals.arrayConsts.get(inner.text) : undefined
      if (!resolved) return null
      values.push(...resolved)
      continue
    }
    const value = stringLiteral(element)
    if (value === null) return null
    values.push(value)
  }
  return values.length > 0 ? values : null
}

/**
 * Module-scope functions whose body returns a single expression: the shape of an
 * option factory (`function llmTransportOption() { return new Option(…).choices(…) }`,
 * or the same as a const arrow). Only the returned expression is kept; a body with
 * several returns names no single construction and is skipped.
 */
function collectOptionFactories(tree: Tree): Map<string, SyntaxNode> {
  const factories = new Map<string, SyntaxNode>()
  for (const node of moduleScopeDeclarations(tree)) {
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text
      const value = soleReturnExpression(node.childForFieldName('body'))
      if (name && value && !factories.has(name)) factories.set(name, value)
      continue
    }
    if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') continue
    for (const declarator of node.namedChildren) {
      if (!declarator || declarator.type !== 'variable_declarator') continue
      const name = declarator.childForFieldName('name')
      const value = declarator.childForFieldName('value')
      if (!name || name.type !== 'identifier' || !value || !isFunctionNode(value)) continue
      const body = value.childForFieldName('body')
      const returned = body?.type === 'statement_block' ? soleReturnExpression(body) : (body ?? null)
      if (returned && !factories.has(name.text)) factories.set(name.text, returned)
    }
  }
  return factories
}

/** The expression of a body's single `return`, ignoring nested functions. */
function soleReturnExpression(body: SyntaxNode | null): SyntaxNode | null {
  if (!body) return null
  const returns: SyntaxNode[] = []
  const walk = (n: SyntaxNode): void => {
    if (isFunctionNode(n)) return
    if (n.type === 'return_statement') {
      returns.push(n)
      return
    }
    for (const child of n.namedChildren) if (child) walk(child)
  }
  for (const child of body.namedChildren) if (child) walk(child)
  return returns.length === 1 ? (returns[0].namedChild(0) ?? null) : null
}

/** Module-scope const arrays of string literals (`as const` unwrapped): what a
 *  spread inside `.choices([…])` may name. */
function collectStringArrayConsts(tree: Tree): Map<string, string[]> {
  const consts = new Map<string, string[]>()
  const empty: LiteralContext = { factories: new Map(), arrayConsts: new Map() }
  for (const node of moduleScopeDeclarations(tree)) {
    if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') continue
    for (const declarator of node.namedChildren) {
      if (!declarator || declarator.type !== 'variable_declarator') continue
      const name = declarator.childForFieldName('name')
      if (!name || name.type !== 'identifier' || consts.has(name.text)) continue
      const values = stringArray(unwrapExpression(declarator.childForFieldName('value')), empty)
      if (values) consts.set(name.text, values)
    }
  }
  return consts
}

/** Module-level statements, with `export` wrappers peeled off. */
function moduleScopeDeclarations(tree: Tree): SyntaxNode[] {
  const nodes: SyntaxNode[] = []
  for (const child of tree.rootNode.namedChildren) {
    if (!child) continue
    if (child.type === 'export_statement') {
      const declaration = child.childForFieldName('declaration')
      if (declaration) nodes.push(declaration)
      continue
    }
    nodes.push(child)
  }
  return nodes
}

/** Strip the wrappers an expression may sit inside (`(…)`, `as const`, `x!`). */
function unwrapExpression(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null
  switch (node.type) {
    case 'parenthesized_expression':
    case 'non_null_expression':
    case 'as_expression':
    case 'satisfies_expression':
      return unwrapExpression(node.namedChild(0))
    default:
      return node
  }
}

/** `<mode>` / `[name]` / `<files...>` — the value a flag spec declares it takes. */
const VALUE_PLACEHOLDER = /^[<[]([^>\]]+)[>\]]$/

/**
 * What a flag spec says about its ARGUMENT: `--transport <mode>` takes a required
 * value called `mode`, `--tag [name]` an optional one, `--json` none. Both bracket
 * forms take a value — the distinction between them is whether it may be omitted,
 * not whether the flag has one.
 */
function valueFacts(spec: string | null): FlagFacts {
  if (!spec) return {}
  for (const token of spec.trim().split(/[\s,|]+/).filter(Boolean)) {
    const match = VALUE_PLACEHOLDER.exec(token)
    if (!match) continue
    const hint = match[1].replace(/\.{3}$/, '').trim()
    return hint ? { takesValue: true, valueHint: hint } : { takesValue: true }
  }
  return {}
}

/**
 * The canonical form of a flag declaration: the LONG form when one is declared
 * (`"-y, --yes"` → `--yes`), the short form otherwise, and a bare yargs option name
 * normalized to its long form (`"verbose"` → `--verbose`). Value placeholders
 * (`--limit <n>`) are stripped from the NAME — they survive as `takesValue` /
 * `valueHint`, which is what a caller needs to build an invocation.
 */
function canonicalFlag(spec: string | null): string | null {
  if (!spec) return null
  const tokens = spec.trim().split(/[\s,|]+/).filter(Boolean)
  if (tokens.length === 0) return null
  const dashed = tokens.filter((t) => t.startsWith('-'))
  if (dashed.length > 0) {
    const chosen = dashed.find((t) => t.startsWith('--')) ?? dashed[0]
    return /^--?[A-Za-z0-9][\w-]*$/.test(chosen) ? chosen : null
  }
  const name = tokens[0]
  if (!/^[A-Za-z0-9][\w-]*$/.test(name)) return null
  return name.length === 1 ? `-${name}` : `--${name}`
}

// ---------------------------------------------------------------------------
// Handlers + literals
// ---------------------------------------------------------------------------

/**
 * The handler symbol behind an action argument: a named function reference
 * directly, or — for the near-universal `(opts) => runThing(opts)` wrapper — the
 * single call the body makes. A body that calls more than one function names no
 * single handler and leaves the field unset.
 */
function handlerName(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'identifier') return node.text
  if (node.type === 'member_expression') return node.childForFieldName('property')?.text ?? null
  if (!isFunctionNode(node)) return null

  const body = node.childForFieldName('body')
  if (!body) return null
  const callees: string[] = []
  const walk = (n: SyntaxNode): void => {
    if (n.type === 'call_expression') {
      const callee = n.childForFieldName('function')
      if (callee?.type === 'identifier') callees.push(callee.text)
      else if (callee?.type === 'member_expression') callees.push(callee.childForFieldName('property')?.text ?? '')
      else callees.push('')
    }
    for (const child of n.namedChildren) if (child) walk(child)
  }
  walk(body)
  return callees.length === 1 && callees[0] ? callees[0] : null
}

/** The value of the first matching key in an object literal. */
function pairValue(objectNode: SyntaxNode, keys: string[]): SyntaxNode | null {
  for (const pair of objectNode.namedChildren) {
    if (!pair || pair.type !== 'pair') continue
    const key = propertyName(pair.childForFieldName('key'))
    if (key && keys.includes(key)) return pair.childForFieldName('value')
  }
  return null
}

/** An object key's name, whether written bare or quoted. */
function propertyName(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'property_identifier') return node.text
  return stringLiteral(node)
}

/** The text of a string literal (or substitution-free template literal), else null. */
function stringLiteral(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (node.type === 'string' || node.type === 'template_string') {
    if (node.namedChildren.some((c) => c?.type === 'template_substitution')) return null
    return node.text.replace(/^["'`]|["'`]$/g, '')
  }
  if (node.type === 'string_fragment') return node.text
  return null
}
