/** Follow Fetch route values through project functions without executing application code.
 * TypeScript owns imports, aliases and re-exports. The evaluator keeps only literal
 * values, object keys, request origins and returned Responses. External calls,
 * dynamic properties and recursive calls stay unknown.
 */
import path from 'node:path'
import ts from 'typescript'
import type { FileAnalysis, RequestContract, RequestField } from '@truecourse/shared'
import { buildScopedCompilerOptions } from './ts-compiler.js'

type Region = 'body' | 'query'
type Value =
  | { kind: 'unknown' }
  | { kind: 'literal'; value: string | number | boolean | null | undefined }
  | { kind: 'input'; region: Region; field?: string }
  | { kind: 'request' | 'url' | 'request-url' | 'headers' }
  | { kind: 'object'; fields: Map<string, Value>; open?: boolean }
  | { kind: 'function'; fn: Fn; env: Env }
  | { kind: 'response'; statuses: number[]; keys: string[] }
  | { kind: 'encoded'; value: Value }
  | { kind: 'union'; values: Value[] }
const UNKNOWN: Value = { kind: 'unknown' }
const UNDEFINED: Value = { kind: 'literal', value: undefined }
type Env = Map<ts.Symbol, Value>
type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
const isFunction = (node: ts.Node): node is Fn => ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
const variants = (value: Value): Value[] => value.kind === 'union' ? value.values : [value]
function union(values: Value[]): Value {
  const flat = [...new Set(values.flatMap(variants))]
  return flat.length === 0 ? UNKNOWN : flat.length === 1 ? flat[0]! : { kind: 'union', values: flat }
}

/** Add cross-file facts to source-backed Fetch handlers. Existing file facts survive.
 * Programs are scoped to each app's compiler options and discarded after this pass.
 * Only analyzed project files are interpreted; node_modules and application side
 * effects are never executed. Calls are bounded per route and cycles return unknown.
 */
export function resolveRequestContracts(repoRoot: string, analyses: readonly FileAnalysis[]): FileAnalysis[] {
  const candidates = analyses.filter((file) => /(?:^|[/\\])route\.[jt]s$/.test(file.filePath) && file.routeRegistrations?.length)
  if (!candidates.length) return [...analyses]
  const scopes = buildScopedCompilerOptions(repoRoot)
  const groups = new Map<ts.CompilerOptions, FileAnalysis[]>()
  const defaults: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  for (const file of candidates) {
    const options = scopes.find((scope) => path.resolve(file.filePath).startsWith(scope.dir + path.sep))?.options ?? defaults
    const group = groups.get(options) ?? []
    group.push(file)
    groups.set(options, group)
  }
  const allowed = new Set(analyses.map((file) => path.resolve(file.filePath)))
  const replacements = new Map<string, FileAnalysis>()
  for (const [scoped, files] of groups) {
    const options = { ...scoped, allowJs: true, noLib: true, noEmit: true, types: [] }
    const host = ts.createCompilerHost(options)
    host.getCurrentDirectory = () => repoRoot
    const read = host.getSourceFile.bind(host)
    host.getSourceFile = (fileName, ...args) => allowed.has(path.resolve(fileName)) ? read(fileName, ...args) : undefined
    const program = ts.createProgram(files.map((file) => file.filePath), options, host)
    const checker = program.getTypeChecker()
    for (const file of files) {
      const source = program.getSourceFile(file.filePath)
      if (!source) continue
      const exports = checker.getSymbolAtLocation(source)
      const byName = new Map(exports ? checker.getExportsOfModule(exports).map((symbol) => [symbol.name, symbol]) : [])
      const routes = file.routeRegistrations!.map((route) => {
        const symbol = byName.get(route.httpMethod)
        if (!symbol) return route
        const evaluator = new ContractEvaluator(checker, allowed)
        const fn = evaluator.functionOf(symbol)
        if (!fn) return route
        const contract = evaluator.analyze(fn)
        return contract ? { ...route, requestContract: mergeContracts(route.requestContract, contract) } : route
      })
      replacements.set(file.filePath, { ...file, routeRegistrations: routes })
    }
  }
  return analyses.map((file) => replacements.get(file.filePath) ?? file)
}

function mergeContracts(existing: RequestContract | undefined, resolved: RequestContract): RequestContract {
  const fields = (a: RequestField[] = [], b: RequestField[] = []): RequestField[] => {
    const merged = new Map(a.map((field) => [field.name, field]))
    for (const field of b) {
      const old = merged.get(field.name)
      if (!old || old.required === 'unknown') merged.set(field.name, field)
    }
    return [...merged.values()]
  }
  const bodyFields = fields(existing?.bodyFields, resolved.bodyFields)
  const queryFields = fields(existing?.queryFields, resolved.queryFields)
  const statuses = [...new Set([...(existing?.produces?.statuses ?? []), ...(resolved.produces?.statuses ?? [])])].sort((a, b) => a - b)
  const bodyKeys = [...new Set([...(existing?.produces?.bodyKeys ?? []), ...(resolved.produces?.bodyKeys ?? [])])].sort()
  return {
    ...existing,
    ...(bodyFields.length ? { bodyFields } : {}),
    ...(queryFields.length ? { queryFields } : {}),
    ...(statuses.length || bodyKeys.length ? { produces: {
      ...(statuses.length ? { statuses } : {}), ...(bodyKeys.length ? { bodyKeys } : {}),
    } } : {}),
  }
}

class ContractEvaluator {
  private readonly active = new Set<ts.Node>()
  private remaining = 12000
  private readonly fields: Record<Region, Map<string, RequestField>> = { body: new Map(), query: new Map() }
  constructor(private checker: ts.TypeChecker, private allowed: Set<string>) {}

  private symbol(node: ts.Node): ts.Symbol | undefined {
    return ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? this.checker.getShorthandAssignmentValueSymbol(node.parent)
      : this.checker.getSymbolAtLocation(node)
  }
  private unalias(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(symbol) : symbol
  }
  functionOf(symbol: ts.Symbol, seen = new Set<ts.Symbol>()): Fn | undefined {
    symbol = this.unalias(symbol)
    if (seen.has(symbol)) return undefined
    seen.add(symbol)
    for (const declaration of symbol.declarations ?? []) {
      if (!this.allowed.has(path.resolve(declaration.getSourceFile().fileName))) continue
      if (isFunction(declaration) && declaration.body) return declaration
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const init = this.unwrap(declaration.initializer)
        if (isFunction(init)) return init
        const target = this.symbol(init)
        if (target) { const fn = this.functionOf(target, seen); if (fn) return fn }
      }
    }
    return undefined
  }
  analyze(fn: Fn): RequestContract | undefined {
    const value = this.invoke(fn, [{ kind: 'request' }, UNKNOWN], new Map())
    const responses = variants(value).filter((v): v is Extract<Value, { kind: 'response' }> => v.kind === 'response')
    const statuses = [...new Set(responses.flatMap((v) => v.statuses))].sort((a, b) => a - b)
    const bodyKeys = [...new Set(responses.flatMap((v) => v.keys))].sort()
    const bodyFields = [...this.fields.body.values()]
    const queryFields = [...this.fields.query.values()]
    if (!bodyFields.length && !queryFields.length && !statuses.length && !bodyKeys.length) return undefined
    return {
      ...(bodyFields.length ? { bodyFields } : {}), ...(queryFields.length ? { queryFields } : {}),
      ...(statuses.length || bodyKeys.length ? { produces: {
        ...(statuses.length ? { statuses } : {}), ...(bodyKeys.length ? { bodyKeys } : {}),
      } } : {}),
    }
  }
  private unwrap(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) node = node.expression
    return node
  }
  private bind(name: ts.BindingName, value: Value, env: Env): void {
    if (ts.isIdentifier(name)) { const symbol = this.symbol(name); if (symbol) env.set(symbol, value); return }
    for (const element of name.elements) {
      if (!ts.isBindingElement(element)) continue
      const key = element.propertyName?.getText().replace(/^['"]|['"]$/g, '') ?? (ts.isIdentifier(element.name) ? element.name.text : '')
      let part = this.property(value, key)
      if (part.kind === 'literal' && part.value === undefined && element.initializer) part = this.eval(element.initializer, env)
      this.bind(element.name, element.dotDotDotToken ? UNKNOWN : part, env)
    }
  }
  private property(value: Value, key: string): Value {
    if (value.kind === 'union') return union(value.values.map((v) => this.property(v, key)))
    if (value.kind === 'object') return value.fields.get(key) ?? (value.open ? UNKNOWN : UNDEFINED)
    if (value.kind === 'request') {
      if (key === 'url') return { kind: 'request-url' }
      if (key === 'nextUrl') return { kind: 'url' }
      if (key === 'headers') return { kind: 'headers' }
    }
    if (value.kind === 'url' && key === 'searchParams') return { kind: 'input', region: 'query' }
    if (value.kind === 'input') {
      if (value.field) return UNKNOWN
      if (!this.fields[value.region].has(key)) this.fields[value.region].set(key, { name: key, required: 'unknown' })
      return { ...value, field: key }
    }
    return UNKNOWN
  }
  private invoke(fn: Fn, args: Value[], parent: Env): Value {
    if (!fn.body || this.active.has(fn) || --this.remaining < 0) return UNKNOWN
    this.active.add(fn)
    try {
      const env = new Map(parent)
      fn.parameters.forEach((parameter, index) => {
        let value = args[index] ?? UNDEFINED
        if (value.kind === 'literal' && value.value === undefined && parameter.initializer) value = this.eval(parameter.initializer, env)
        this.bind(parameter.name, value, env)
      })
      if (!ts.isBlock(fn.body)) return this.eval(fn.body, env)
      const result = this.block(fn.body.statements, env)
      if (this.remaining < 0) return UNKNOWN
      // Writes through a closure cannot retain the caller's old literal value.
      for (const [symbol, value] of parent) if (env.get(symbol) !== value) parent.set(symbol, UNKNOWN)
      return union([...result.values, ...(result.falls ? [UNDEFINED] : [])])
    } finally { this.active.delete(fn) }
  }
  private block(statements: ts.NodeArray<ts.Statement>, env: Env): { values: Value[]; falls: boolean } {
    const values: Value[] = []
    for (const statement of statements) {
      const result = this.statement(statement, env)
      values.push(...result.values)
      if (!result.falls) return { values, falls: false }
    }
    return { values, falls: true }
  }
  private statement(node: ts.Statement, env: Env): { values: Value[]; falls: boolean } {
    const next = { values: [] as Value[], falls: true }
    if (--this.remaining < 0) return next
    if (ts.isReturnStatement(node)) return { values: [node.expression ? this.eval(node.expression, env) : UNDEFINED], falls: false }
    if (ts.isThrowStatement(node)) { this.eval(node.expression, env); return { values: [], falls: false } }
    if (ts.isBlock(node)) return this.block(node.statements, env)
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) this.bind(declaration.name, declaration.initializer ? this.eval(declaration.initializer, env) : UNDEFINED, env)
    } else if (ts.isExpressionStatement(node)) this.eval(node.expression, env)
    else if (ts.isIfStatement(node)) {
      const condition = this.eval(node.expression, env)
      if (condition.kind === 'literal') return condition.value ? this.statement(node.thenStatement, env) : node.elseStatement ? this.statement(node.elseStatement, env) : next
      const yesEnv = new Map(env), noEnv = new Map(env)
      const yes = this.statement(node.thenStatement, yesEnv)
      const no = node.elseStatement ? this.statement(node.elseStatement, noEnv) : next
      this.mergeEnvs(env, [yes.falls ? yesEnv : null, no.falls ? noEnv : null])
      return { values: [...yes.values, ...no.values], falls: yes.falls || no.falls }
    } else if (ts.isTryStatement(node)) {
      const bodyEnv = new Map(env), catchEnv = new Map(env)
      const body = this.statement(node.tryBlock, bodyEnv)
      const caught = node.catchClause ? this.statement(node.catchClause.block, catchEnv) : { values: [], falls: false }
      this.mergeEnvs(env, [body.falls ? bodyEnv : null, caught.falls ? catchEnv : null])
      const final = node.finallyBlock ? this.statement(node.finallyBlock, env) : next
      return { values: final.falls ? [...body.values, ...caught.values, ...final.values] : final.values, falls: final.falls && (body.falls || caught.falls) }
    } else if (ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      this.eval(node.expression, env)
      const result = this.statement(node.statement, new Map(env))
      return { values: result.values, falls: true }
    }
    return next
  }
  private mergeEnvs(target: Env, branches: (Env | null)[]): void {
    const live = branches.filter((branch): branch is Env => branch !== null)
    if (!live.length) return
    for (const symbol of new Set(live.flatMap((branch) => [...branch.keys()]))) {
      target.set(symbol, union(live.map((branch) => branch.get(symbol) ?? UNKNOWN)))
    }
  }
  private eval(expression: ts.Expression, env: Env): Value {
    if (--this.remaining < 0) return UNKNOWN
    const node = this.unwrap(expression)
    if (ts.isStringLiteralLike(node)) return { kind: 'literal', value: node.text }
    if (ts.isNumericLiteral(node)) return { kind: 'literal', value: Number(node.text) }
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', value: node.kind === ts.SyntaxKind.TrueKeyword }
    if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null }
    if (ts.isIdentifier(node)) {
      const symbol = this.symbol(node)
      if (!symbol) return node.text === 'undefined' ? UNDEFINED : UNKNOWN
      if (env.has(symbol)) return env.get(symbol)!
      const fn = this.functionOf(symbol)
      if (fn) return { kind: 'function', fn, env }
      const declaration = this.unalias(symbol).valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && this.allowed.has(path.resolve(declaration.getSourceFile().fileName)) && !this.active.has(declaration)) {
        this.active.add(declaration)
        try { return this.eval(declaration.initializer, env) } finally { this.active.delete(declaration) }
      }
      return UNKNOWN
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { kind: 'function', fn: node, env }
    if (ts.isObjectLiteralExpression(node)) {
      let open = false
      const fields = new Map<string, Value>()
      for (const item of node.properties) {
        if (ts.isSpreadAssignment(item)) {
          const spread = this.eval(item.expression, env)
          if (spread.kind === 'object') {
            if (spread.open) { open = true; for (const key of fields.keys()) fields.set(key, UNKNOWN) }
            for (const [key, value] of spread.fields) fields.set(key, value)
          } else { open = true; for (const key of fields.keys()) fields.set(key, UNKNOWN) }
          continue
        }
        if (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) {
          const key = ts.isComputedPropertyName(item.name) ? this.eval(item.name.expression, env) : { kind: 'literal' as const, value: item.name.getText().replace(/^['"]|['"]$/g, '') }
          const value = this.eval(ts.isPropertyAssignment(item) ? item.initializer : item.name, env)
          if (key.kind === 'literal' && typeof key.value === 'string') fields.set(key.value, value)
        }
      }
      return { kind: 'object', fields, ...(open ? { open: true } : {}) }
    }
    if (ts.isArrayLiteralExpression(node)) { for (const element of node.elements) this.eval(element, env); return UNKNOWN }
    if (ts.isPropertyAccessExpression(node)) {
      const namespace = this.symbol(node.expression)?.declarations?.some((declaration) => ts.isNamespaceImport(declaration))
      if (namespace) {
        const symbol = this.symbol(node.name)
        const fn = symbol ? this.functionOf(symbol) : undefined
        if (fn) return { kind: 'function', fn, env }
      }
      return this.property(this.eval(node.expression, env), node.name.text)
    }
    if (ts.isElementAccessExpression(node)) {
      const value = this.eval(node.expression, env), key = this.eval(node.argumentExpression, env)
      return key.kind === 'literal' && typeof key.value === 'string' ? this.property(value, key.value) : UNKNOWN
    }
    if (ts.isConditionalExpression(node)) {
      const condition = this.eval(node.condition, env)
      return condition.kind === 'literal' ? this.eval(condition.value ? node.whenTrue : node.whenFalse, env) : union([this.eval(node.whenTrue, new Map(env)), this.eval(node.whenFalse, new Map(env))])
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const value = this.eval(node.right, env)
        if (ts.isIdentifier(node.left)) { const symbol = this.symbol(node.left); if (symbol) env.set(symbol, value) }
        else if (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)) {
          const receiver = this.eval(node.left.expression, env)
          const key = ts.isPropertyAccessExpression(node.left) ? { kind: 'literal' as const, value: node.left.name.text } : this.eval(node.left.argumentExpression, env)
          for (const object of variants(receiver)) if (object.kind === 'object') {
            if (key.kind === 'literal' && typeof key.value === 'string') object.fields.set(key.value, UNKNOWN)
            else { object.open = true; for (const name of object.fields.keys()) object.fields.set(name, UNKNOWN) }
          }
        }
        return value
      }
      const left = this.eval(node.left, env)
      if ([ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
        if (left.kind === 'literal') {
          const useRight = node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? left.value == null : node.operatorToken.kind === ts.SyntaxKind.BarBarToken ? !left.value : !!left.value
          return useRight ? this.eval(node.right, env) : left
        }
        return union([left, this.eval(node.right, env)])
      }
      this.eval(node.right, env)
      return UNKNOWN
    }
    if (ts.isPrefixUnaryExpression(node)) { this.eval(node.operand, env); return UNKNOWN }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node)) { this.eval(node.expression, env); return UNKNOWN }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) return this.call(node, env)
    return UNKNOWN
  }
  /** Recognize platform APIs only when the identifier is not shadowed by project code. */
  private platform(node: ts.Expression, name: string): boolean {
    if (!ts.isIdentifier(node)) return false
    const declarations = this.symbol(node)?.declarations ?? []
    if (name === 'NextResponse') return declarations.some((declaration) => {
      if (!ts.isImportSpecifier(declaration) || (declaration.propertyName?.text ?? declaration.name.text) !== 'NextResponse') return false
      const statement = declaration.parent.parent.parent
      return ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === 'next/server'
    })
    return node.text === name && declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile)
  }
  private call(node: ts.CallExpression | ts.NewExpression, env: Env): Value {
    const callee = this.unwrap(node.expression)
    const args = (node.arguments ?? []).map((arg) => this.eval(arg, env))
    if (ts.isNewExpression(node) && this.platform(callee, 'URL')) return args[0]?.kind === 'request-url' ? { kind: 'url' } : UNKNOWN
    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = this.eval(callee.expression, env), method = callee.name.text
      if (receiver.kind === 'request' && ['json', 'text', 'formData'].includes(method)) {
        const value: Value = { kind: 'input', region: 'body' }
        return method === 'text' ? { kind: 'encoded', value } : value
      }
      if (receiver.kind === 'input' && !receiver.field && ['get', 'getAll', 'has'].includes(method)) {
        const key = args[0]
        return key?.kind === 'literal' && typeof key.value === 'string' ? this.property(receiver, key.value) : UNKNOWN
      }
      if (this.platform(callee.expression, 'JSON')) {
        if (method === 'parse') return args[0]?.kind === 'encoded' ? args[0].value : UNKNOWN
        if (method === 'stringify') return { kind: 'encoded', value: args[0] ?? UNKNOWN }
      }
      if ((this.platform(callee.expression, 'Response') || this.platform(callee.expression, 'NextResponse')) && method === 'json') return this.response(args[0], args[1])
    }
    if (ts.isNewExpression(node) && (this.platform(callee, 'Response') || this.platform(callee, 'NextResponse'))) return this.response(args[0]?.kind === 'encoded' ? args[0].value : UNKNOWN, args[1])
    const target = this.eval(callee, env)
    const results = variants(target).map((value) => value.kind === 'function' ? this.invoke(value.fn, args, value.env) : UNKNOWN)
    if (results.some((value) => value !== UNKNOWN)) return union(results)
    // Visit receiver reads even when the method itself is external or dynamic.
    if (ts.isPropertyAccessExpression(callee)) this.eval(callee.expression, env)
    return UNKNOWN
  }
  private response(body: Value | undefined, init: Value | undefined): Value {
    const statuses: number[] = []
    for (const value of variants(init ?? UNDEFINED)) {
      const status = value.kind === 'literal' && value.value === undefined ? UNDEFINED : value.kind === 'object' ? this.property(value, 'status') : UNKNOWN
      for (const choice of variants(status)) {
        if (choice.kind === 'literal' && choice.value === undefined) statuses.push(200)
        else if (choice.kind === 'literal' && typeof choice.value === 'number' && Number.isInteger(choice.value) && choice.value >= 200 && choice.value <= 599) statuses.push(choice.value)
      }
    }
    const keys = variants(body ?? UNKNOWN).flatMap((value) => value.kind === 'object' ? [...value.fields.keys()] : [])
    return { kind: 'response', statuses, keys }
  }
}
