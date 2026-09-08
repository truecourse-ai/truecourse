import type { InterfaceCommandContract, InterfaceOption, InterfacePositional } from '@truecourse/shared'

/** Read only explicit argument placeholders; options and command selectors are not positionals. */
export function cliPositionals(syntax: string): InterfacePositional[] {
  const argumentsOnly = syntax
    .replace(/\[--?[^\]]*\]/g, '')
    .replace(/--?[\w-]+(?:[ =]+(?:<[^>]+>|\[[^\]]+\]|[A-Z][A-Z_0-9]*))?/g, '')
  return [...argumentsOnly.matchAll(/<([^<>]+)>|\[([^\[\]]+)\]/g)].flatMap((match) => {
    const raw = match[1] ?? match[2]
    if (!raw || /^(options?|commands?)$/i.test(raw) || raw.startsWith('-') || /\s/.test(raw)) return []
    const variadic = raw.endsWith('...')
    return [{ name: variadic ? raw.slice(0, -3) : raw, required: match[1] !== undefined, ...(variadic ? { variadic } : {}) }]
  })
}

/** Commander/help option declarations have explicit value syntax. Bare yargs names do not. */
export function cliOption(syntax: string, description?: string): InterfaceOption | undefined {
  if (!syntax.trim().startsWith('-')) return undefined
  const names = syntax.match(/--?[A-Za-z0-9][\w-]*/g)
  if (!names?.length) return undefined
  const flag = names.find((name) => name.startsWith('--')) ?? names[0]!
  const short = names.find((name) => !name.startsWith('--') && name !== flag)
  const value = /<([^<>]+)>|\[([^\[\]]+)\]|(?:\s|=)([A-Z][A-Z_0-9]*)(?=\s|$)/.exec(syntax)
  return {
    flag,
    ...(short ? { short } : {}),
    takesValue: value !== null,
    valueRequired: value !== null && value[2] === undefined,
    ...(value ? { valueHint: (value[1] ?? value[2] ?? value[3])! } : {}),
    ...(description ? { description } : {}),
  }
}

/** Merge observed regions, preferring the first source when both describe the same fact. */
export function mergeCliContracts(
  preferred: InterfaceCommandContract | undefined,
  other: InterfaceCommandContract | undefined,
): InterfaceCommandContract | undefined {
  if (!preferred) return other
  if (!other) return preferred
  const options = new Map(other.options?.map((option) => [option.flag, option]))
  for (const option of preferred.options ?? []) options.set(option.flag, { ...options.get(option.flag), ...option })
  return {
    ...other,
    ...preferred,
    ...(preferred.options || other.options ? { options: [...options.values()] } : {}),
  }
}

/**
 * Read a command's usage or its row in a parent's Commands section. In particular,
 * a hand-written CLI may document every command at the root and reject `cmd --help`.
 * That error must not erase the grammar already printed by the root.
 */
export function cliHelpContract(
  text: string,
  programName: string,
  command: readonly string[],
  context: readonly string[] = [],
): InterfaceCommandContract | undefined {
  const lines = text.split('\n')
  const usage: string[] = []
  const listings: { text: string; indent: number }[] = []
  const optionLines: string[] = []
  let section = ''
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const usageHeading = /^usage\s*:\s*(.*)$/i.exec(line)
    if (usageHeading) {
      section = 'usage'
      if (usageHeading[1]) usage.push(usageHeading[1])
    } else if (/^[a-z ]*\b(sub)?commands\b\s*:?\s*$/i.test(trimmed)) {
      section = 'commands'
    } else if (/^(options|optional arguments|flags)\s*:\s*$/i.test(trimmed)) {
      section = 'options'
    } else if (!/^\s/.test(line)) {
      section = ''
    } else if (section === 'usage') {
      usage.push(trimmed)
    } else if (section === 'commands') {
      listings.push({ text: trimmed, indent: line.length - line.trimStart().length })
    } else if (section === 'options') {
      optionLines.push(trimmed)
    }
  }

  const path = [programName, ...command]
  let result: InterfaceCommandContract | undefined
  let ownUsage = false
  const readSignature = (line: string, prefix: readonly string[]): InterfaceCommandContract | undefined => {
    const [signature = '', description] = line.split(/\s{2,}/, 2)
    const tokens = signature.trim().split(/\s+/)
    if (!prefix.every((part, index) => tokens[index] === part)) return undefined
    const remainder = tokens.slice(prefix.length).join(' ')
    // A longer command is a different interface, not this command's arguments.
    if (remainder && !/^[<\[]/.test(remainder)) return undefined
    const positionals = cliPositionals(remainder)
    if (!positionals.length && !description) return undefined
    return { path, ...(description ? { description } : {}), ...(positionals.length ? { positionals } : {}) }
  }
  for (const line of usage) {
    const tokens = line.trim().split(/\s+/)
    const remainder = tokens[path.length]
    if (path.every((part, index) => tokens[index] === part) && (!remainder || /^[<\[]/.test(remainder))) ownUsage = true
    result = mergeCliContracts(result, readSignature(line, path))
  }
  if (command.length === context.length + 1 && context.every((part, index) => command[index] === part)) {
    const baseIndent = Math.min(...listings.map((line) => line.indent))
    for (const line of listings) {
      if (line.indent === baseIndent) result = mergeCliContracts(result, readSignature(line.text, command.slice(-1)))
    }
  }

  // Options belong to the probed command, never to every command listed at the root.
  if (command.join(' ') === context.join(' ') && (ownUsage || usage.length === 0)) {
    const options = optionLines.flatMap((line) => {
      const [syntax = '', description] = line.split(/\s{2,}/, 2)
      const option = cliOption(syntax, description)
      return option ? [option] : []
    })
    if (options.length) result = { path, ...result, options: [...new Map(options.map((option) => [option.flag, option])).values()] }
  }
  return result
}
