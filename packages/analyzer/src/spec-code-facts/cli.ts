import ts from 'typescript'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { pushFact, rangeOf } from './utils.js'
import type { StaticValueResolver } from './static-values.js'

interface CliArgument {
  name: string
  required: boolean
  variadic: boolean
  description?: string
}

interface CliOption {
  name: string
  shortName?: string
  argument?: string
  required: boolean
  negated: boolean
  description?: string
}

interface CommandModel {
  id: string
  node: ts.Node
  name: string
  path: string[]
  parentPath: string[]
  description?: string
  aliases: string[]
  options: CliOption[]
  arguments: CliArgument[]
  hasAction: boolean
}

interface RootModel {
  names: Set<string>
  descriptions: string[]
}

interface CommanderBindingEvidence {
  commandConstructorNames: Set<string>
  namespaceNames: Set<string>
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function parseSignature(signature: string): { name: string; args: CliArgument[] } | undefined {
  const normalized = normalizeSpaces(signature)
  const commandName = normalized.match(/^[^\s<[]+/)?.[0]
  if (!commandName) return undefined
  const args = [...normalized.matchAll(/(<([^>\s]+)>|\[([^\]\s]+)\])/g)].map((match) => {
    const token = match[2] ?? match[3] ?? ''
    const variadic = token.endsWith('...')
    return {
      name: variadic ? token.slice(0, -3) : token,
      required: match[0].startsWith('<'),
      variadic,
    }
  }).filter((arg) => arg.name.length > 0)
  return { name: commandName, args }
}

function parseOptionSignature(signature: string, required: boolean, description?: string): CliOption | undefined {
  const parts = signature.split(/[,\s|]+/).map((part) => part.trim()).filter(Boolean)
  const shortName = parts.find((part) => /^-[^-]/.test(part))
  const longName = parts.find((part) => part.startsWith('--'))
  const name = longName ?? shortName
  if (!name) return undefined
  const argumentMatch = signature.match(/[<[]([^>\]\s.]+)(?:\.\.\.)?[>\]]/)
  return {
    name,
    ...(shortName && shortName !== name ? { shortName } : {}),
    ...(argumentMatch?.[1] ? { argument: argumentMatch[1] } : {}),
    required,
    negated: name.startsWith('--no-'),
    ...(description ? { description } : {}),
  }
}

function commandCallKey(unit: SourceUnit, node: ts.Node): string {
  return `${unit.sourceFile}:${node.getStart(unit.ast)}`
}

function variableNameFromDeclarationName(name: ts.BindingName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined
}

function isCommanderModule(source: string): boolean {
  return source === 'commander'
}

function isRequireCommander(node: ts.Expression | undefined): boolean {
  return Boolean(
    node
    && ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
    && node.arguments[0]
    && ts.isStringLiteralLike(node.arguments[0])
    && isCommanderModule(node.arguments[0].text),
  )
}

function collectCommanderBindingEvidence(unit: SourceUnit): CommanderBindingEvidence {
  const evidence: CommanderBindingEvidence = {
    commandConstructorNames: new Set(),
    namespaceNames: new Set(),
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isCommanderModule(node.moduleSpecifier.text)) {
      const clause = node.importClause
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        evidence.namespaceNames.add(clause.namedBindings.name.text)
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text
          if (importedName === 'Command') evidence.commandConstructorNames.add(element.name.text)
        }
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer && isRequireCommander(node.initializer)) {
      if (ts.isIdentifier(node.name)) {
        evidence.namespaceNames.add(node.name.text)
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text
          if (importedName === 'Command') evidence.commandConstructorNames.add(element.name.text)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
  return evidence
}

function isNewCommand(node: ts.Node, evidence: CommanderBindingEvidence): boolean {
  if (!ts.isNewExpression(node)) return false
  if (ts.isIdentifier(node.expression)) return evidence.commandConstructorNames.has(node.expression.text)
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'Command'
    && ts.isIdentifier(node.expression.expression)
  ) {
    return evidence.namespaceNames.has(node.expression.expression.text)
  }
  return false
}

export function extractCliFacts(unit: SourceUnit, resolver: StaticValueResolver): void {
  const bindingEvidence = collectCommanderBindingEvidence(unit)
  if (bindingEvidence.commandConstructorNames.size === 0 && bindingEvidence.namespaceNames.size === 0) return

  const rootRefs = new Set<string>()
  const commandRefs = new Map<string, CommandModel>()
  const commandsByCall = new Map<string, CommandModel>()
  const commands: CommandModel[] = []
  const root: RootModel = { names: new Set(), descriptions: [] }

  const stringArg = (call: ts.CallExpression, index: number): string | undefined => resolver.resolveString(unit, call.arguments[index])

  const commandForExpression = (expression: ts.Expression): CommandModel | 'root' | undefined => {
    if (ts.isIdentifier(expression)) {
      if (commandRefs.has(expression.text)) return commandRefs.get(expression.text)
      if (rootRefs.has(expression.text)) return 'root'
      return undefined
    }

    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return undefined

    const method = expression.expression.name.text
    const receiver = commandForExpression(expression.expression.expression)

    if (method === 'command') {
      if (!receiver) return undefined
      const signature = stringArg(expression, 0)
      const parsed = signature ? parseSignature(signature) : undefined
      if (!parsed) return undefined
      const parentPath = receiver === 'root' ? [] : receiver.path
      const key = commandCallKey(unit, expression)
      const existing = commandsByCall.get(key)
      if (existing) return existing
      const model: CommandModel = {
        id: key,
        node: expression,
        name: parsed.name,
        path: [...parentPath, parsed.name],
        parentPath,
        aliases: [],
        options: [],
        arguments: [...parsed.args],
        hasAction: false,
      }
      commandsByCall.set(key, model)
      commands.push(model)
      return model
    }

    if (receiver === 'root') {
      if (method === 'name') {
        const value = stringArg(expression, 0)
        if (value) root.names.add(value)
      } else if (method === 'description') {
        const value = stringArg(expression, 0)
        if (value) root.descriptions.push(value)
      }
      return 'root'
    }

    if (!receiver) return undefined
    if (method === 'description') {
      const value = stringArg(expression, 0)
      if (value) receiver.description = value
    } else if (method === 'alias') {
      const value = stringArg(expression, 0)
      if (value && !receiver.aliases.includes(value)) receiver.aliases.push(value)
    } else if (method === 'option' || method === 'requiredOption') {
      const signature = stringArg(expression, 0)
      const option = signature ? parseOptionSignature(signature, method === 'requiredOption', stringArg(expression, 1)) : undefined
      if (option) receiver.options.push(option)
    } else if (method === 'argument') {
      const signature = stringArg(expression, 0)
      const parsed = signature ? parseSignature(`arg ${signature}`) : undefined
      if (parsed?.args[0]) {
        receiver.arguments.push({
          ...parsed.args[0],
          ...(stringArg(expression, 1) ? { description: stringArg(expression, 1) } : {}),
        })
      }
    } else if (method === 'action') {
      receiver.hasAction = true
    }
    return receiver
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const varName = variableNameFromDeclarationName(node.name)
      if (varName && isNewCommand(node.initializer, bindingEvidence)) {
        rootRefs.add(varName)
      }
      if (varName) {
        const command = commandForExpression(node.initializer)
        if (command && command !== 'root') commandRefs.set(varName, command)
      }
    }

    if (ts.isCallExpression(node)) {
      commandForExpression(node)
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)

  for (const name of [...root.names].sort()) {
    pushFact(
      unit.facts,
      unit.sourceFile,
      { startLine: 1, endLine: 1 },
      'cli.binary',
      'binary.defined',
      { name, source: 'commander' },
      EXTRACTORS.cli,
    )
  }

  const binaryName = [...root.names].sort()[0]
  for (const command of commands) {
    const fullPath = binaryName ? [binaryName, ...command.path] : command.path
    const commandValue = {
      name: command.name,
      fullName: fullPath.join(' '),
      path: command.path,
      parentPath: command.parentPath,
      ...(command.description ? { description: command.description } : {}),
      aliases: command.aliases.sort(),
      source: 'commander',
      hasAction: command.hasAction,
    }
    pushFact(unit.facts, unit.sourceFile, rangeOf(unit.ast, command.node), 'cli.command', 'command.defined', commandValue, EXTRACTORS.cli)

    for (const option of command.options) {
      pushFact(
        unit.facts,
        unit.sourceFile,
        rangeOf(unit.ast, command.node),
        'cli.option',
        'option.defined',
        { command: commandValue.fullName, commandPath: command.path, ...option },
        EXTRACTORS.cli,
      )
    }

    for (const arg of command.arguments) {
      pushFact(
        unit.facts,
        unit.sourceFile,
        rangeOf(unit.ast, command.node),
        'cli.argument',
        'argument.defined',
        { command: commandValue.fullName, commandPath: command.path, ...arg },
        EXTRACTORS.cli,
      )
    }
  }
}
