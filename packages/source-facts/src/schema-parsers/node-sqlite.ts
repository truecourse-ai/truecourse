/**
 * Static node:sqlite DDL. Resolve DatabaseSync and its local instance through the
 * TypeScript AST, then read literal SQL passed to exec. Never evaluate source or
 * SQL. Dynamic SQL, imported DDL, CREATE AS and virtual tables remain unknown.
 */
import ts from 'typescript'
import type { ColumnInfo, RelationInfo, TableInfo } from '@truecourse/shared'

export function parseNodeSqliteSchema(source: string): { tables: TableInfo[]; relations: RelationInfo[] } {
  const fileName = '/sqlite-schema.ts'
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const host: ts.CompilerHost = {
    getSourceFile: name => name === fileName ? file : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/',
    getDirectories: () => [], fileExists: name => name === fileName,
    readFile: name => name === fileName ? source : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  }
  const checker = ts.createProgram([fileName], { noLib: true, noResolve: true }, host).getTypeChecker()
  const constructors = new Set<ts.Symbol>()
  const namespaces = new Set<ts.Symbol>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'node:sqlite' || statement.importClause?.isTypeOnly) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings) continue
    if (ts.isNamespaceImport(bindings)) {
      const symbol = checker.getSymbolAtLocation(bindings.name)
      if (symbol) namespaces.add(symbol)
    } else for (const binding of bindings.elements) {
      if (binding.isTypeOnly || (binding.propertyName ?? binding.name).text !== 'DatabaseSync') continue
      const symbol = checker.getSymbolAtLocation(binding.name)
      if (symbol) constructors.add(symbol)
    }
  }
  const isConstructor = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return constructors.has(checker.getSymbolAtLocation(expr)!)
    return ts.isPropertyAccessExpression(expr) && expr.name.text === 'DatabaseSync' &&
      namespaces.has(checker.getSymbolAtLocation(expr.expression)!)
  }
  const isDatabase = (expr: ts.Expression): boolean => {
    if (ts.isNewExpression(expr)) return isConstructor(expr.expression)
    if (!ts.isIdentifier(expr)) return false
    return (checker.getSymbolAtLocation(expr)?.declarations ?? []).some(decl =>
      ts.isVariableDeclaration(decl) && !!decl.initializer && ts.isNewExpression(decl.initializer) &&
      isConstructor(decl.initializer.expression) && ts.isVariableDeclarationList(decl.parent) &&
      !!(decl.parent.flags & ts.NodeFlags.Const))
  }
  const tables = new Map<string, TableInfo>()
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exec' && isDatabase(node.expression.expression)) {
      const argument = node.arguments[0]
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        for (const statement of split(tokens(argument.text), ';')) {
          const table = createTable(statement)
          if (table && !tables.has(table.name)) tables.set(table.name, table)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  const result = [...tables.values()]
  const relations = result.flatMap(table => table.columns.filter(c => c.referencesTable).map(c => ({
    sourceTable: table.name, targetTable: c.referencesTable!, foreignKeyColumn: c.name,
    ...(c.referencesColumn ? { foreignKeyReferencesColumn: c.referencesColumn } : {}),
    relationType: c.isUnique ? 'one-to-one' as const : 'one-to-many' as const,
  })))
  return { tables: result, relations }
}

interface Token { raw: string; value: string; quoted: boolean }
function tokens(sql: string): Token[] {
  // Quotes/comments are single tokens, so their commas and parentheses cannot
  // split columns. Unclosed quotes/comments reject the batch rather than invent DDL.
  const pattern = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][\w$]*|\d+(?:\.\d+)?|./gy
  const out: Token[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql))) {
    const raw = match[0]
    if (/^\s|^--|^\/\*/.test(raw)) continue
    const quoted = /^["'`\[]/.test(raw)
    if ((quoted && raw.length === 1) || (raw === '/' && sql[pattern.lastIndex] === '*')) return []
    out.push({ raw, value: quoted ? raw.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"').replace(/``/g, '`') : raw, quoted })
  }
  return out
}
const word = (t: Token | undefined, text: string): boolean => !!t && !t.quoted && t.value.toUpperCase() === text
const punctuation = (t: Token | undefined, text: string): boolean => !!t && !t.quoted && t.raw === text
const identifier = (t: Token | undefined): string | undefined => t && (t.quoted || /^[A-Za-z_][\w$]*$/.test(t.value)) ? t.value : undefined

/** Split only at the outer level, leaving expressions such as CHECK(...) whole. */
function split(items: Token[], separator: string): Token[][] {
  const result: Token[][] = []
  let start = 0, depth = 0
  for (let i = 0; i < items.length; i++) {
    if (punctuation(items[i], '(')) depth++
    if (punctuation(items[i], ')')) depth--
    if (depth < 0) return []
    if (depth === 0 && punctuation(items[i], separator)) { result.push(items.slice(start, i)); start = i + 1 }
  }
  if (depth !== 0) return []
  result.push(items.slice(start))
  return result.filter(part => part.length > 0)
}
function closing(items: Token[], start: number): number {
  let depth = 0
  for (let i = start; i < items.length; i++) {
    if (punctuation(items[i], '(')) depth++
    if (punctuation(items[i], ')') && --depth === 0) return i
  }
  return -1
}
const CONSTRAINTS = new Set(['CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS'])
function isConstraint(t: Token): boolean { return !t.quoted && CONSTRAINTS.has(t.value.toUpperCase()) }
function createTable(items: Token[]): TableInfo | null {
  let i = 0
  if (!word(items[i++], 'CREATE')) return null
  if (word(items[i], 'TEMP') || word(items[i], 'TEMPORARY')) i++
  if (!word(items[i++], 'TABLE')) return null
  if (word(items[i], 'IF') && word(items[i + 1], 'NOT') && word(items[i + 2], 'EXISTS')) i += 3
  const name = identifier(items[i++])
  if (!name || !punctuation(items[i], '(')) return null
  const end = closing(items, i)
  if (end < 0) return null
  const columns: ColumnInfo[] = []
  const tableConstraints: Token[][] = []
  const descendingKeys = new Set<string>()
  for (const definition of split(items.slice(i + 1, end), ',')) {
    if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].some(w => word(definition[0], w))) {
      tableConstraints.push(definition)
      continue
    }
    const columnName = identifier(definition[0])
    if (!columnName) return null
    let k = 1
    while (k < definition.length && !isConstraint(definition[k]!)) {
      if (punctuation(definition[k], '(')) {
        const close = closing(definition, k)
        if (close < 0) return null
        k = close
      }
      k++
    }
    const column: ColumnInfo = { name: columnName, type: definition.slice(1, k).map(t => t.value).join(' '), isNullable: true }
    for (; k < definition.length; k++) {
      const current = definition[k]
      if (word(current, 'PRIMARY') && word(definition[k + 1], 'KEY')) {
        column.isPrimaryKey = true
        if (word(definition[k + 2], 'DESC')) descendingKeys.add(columnName)
      }
      if (word(current, 'NOT') && word(definition[k + 1], 'NULL')) column.isNullable = false
      if (word(current, 'UNIQUE')) column.isUnique = true
      if (word(current, 'REFERENCES')) {
        column.referencesTable = identifier(definition[k + 1])
        if (punctuation(definition[k + 2], '(')) column.referencesColumn = identifier(definition[k + 3])
        column.isForeignKey = !!column.referencesTable
      }
      if (word(current, 'DEFAULT')) {
        const start = ++k
        if (punctuation(definition[k], '(')) k = closing(definition, k)
        else if (punctuation(definition[k], '-') || punctuation(definition[k], '+')) k++
        if (k < 0 || !definition[k]) return null
        column.defaultValue = definition.slice(start, k + 1).map(t => t.raw).join(' ')
      } else if (punctuation(current, '(')) {
        k = closing(definition, k) // Ignore words inside CHECK/GENERATED expressions.
        if (k < 0) return null
      }
    }
    columns.push(column)
  }
  if (columns.length === 0) return null
  for (let constraint of tableConstraints) {
    if (word(constraint[0], 'CONSTRAINT')) constraint = constraint.slice(2)
    const primary = word(constraint[0], 'PRIMARY') && word(constraint[1], 'KEY')
    const unique = word(constraint[0], 'UNIQUE')
    if (!primary && !unique) continue
    const at = primary ? 2 : 1
    if (!punctuation(constraint[at], '(')) continue
    const names = split(constraint.slice(at + 1, closing(constraint, at)), ',').map(part => identifier(part[0]))
    for (const column of columns.filter(c => names.includes(c.name))) {
      if (primary) column.isPrimaryKey = true
      if (unique && names.length === 1) column.isUnique = true
    }
  }
  const keys = columns.filter(c => c.isPrimaryKey)
  // SQLite permits nullable non-integer primary keys in ordinary rowid tables.
  // https://www.sqlite.org/lang_createtable.html#the_primary_key
  const strictKeys = items.slice(end + 1).some(t => word(t, 'STRICT') || word(t, 'WITHOUT'))
  for (const column of keys) {
    if (strictKeys || (keys.length === 1 && column.type.toUpperCase() === 'INTEGER' && !descendingKeys.has(column.name))) column.isNullable = false
    if (keys.length === 1) column.isUnique = true
  }
  return { name, columns, ...(keys.length === 1 ? { primaryKey: keys[0]!.name } : {}) }
}
