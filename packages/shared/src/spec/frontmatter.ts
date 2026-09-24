/**
 * The facts a document states ABOUT ITSELF, read out of its leading YAML
 * frontmatter block.
 *
 * A synced ticket opens with one: when it was created, when it last moved,
 * when it resolved, the workflow state it sits in, the coarse category that
 * state files under, and the transitions that got it there. Those are the
 * facts a reader — and the scan sessions that adjudicate two documents against
 * each other — need in order to tell a delivered decision from a plan.
 *
 * Deliberately a READER, not a YAML parser. It lives on the package root, which
 * the dashboard client bundles, so it pulls in no `js-yaml`; the block's shape
 * is the one our connectors write (scalar `key: value` lines plus one list of
 * quoted strings), and anything it does not recognize is simply absent. It
 * never throws: a document that states nothing yields nothing.
 */

/** One recorded workflow transition, as a status history states it. */
export interface StatusTransition {
  /** When it happened, ISO — absent when the line states no instant. */
  at?: string
  /** The state left behind, verbatim (our writers state `(none)` for the first). */
  from: string
  /** The state entered, verbatim. */
  to: string
}

/** What a document's frontmatter states about itself. Every field optional. */
export interface DocFrontmatter {
  created?: string
  updated?: string
  resolved?: string
  /** The workflow state's NAME, exactly as stated — never classified here. */
  status?: string
  /** The coarse bucket the tracker files that name under (`done`, `to do`, …). */
  statusCategory?: string
  /** The transitions the block lists, oldest first. */
  statusHistory: StatusTransition[]
  /** Earlier transitions the writer dropped rather than truncating silently. */
  omittedTransitions: number
}

/**
 * A YAML frontmatter block opening the document. The fence must be the first
 * line and must close, so a `---` used as a horizontal rule is not mistaken
 * for one.
 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** `key: value` at the block's top level. */
const SCALAR = /^([A-Za-z][\w .-]*)\s*:\s*(.*)$/
/** `  - "entry"` — an item of the list the preceding key opened. */
const ITEM = /^\s+-\s+(.*)$/
/** `… 3 earlier transitions omitted` — what a capped history says it dropped. */
const OMITTED = /(\d+)\s+earlier\s+transitions?\s+omitted/i

/** Strip the quotes a YAML writer adds, and the escapes inside them. */
function unquote(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

/** A stated instant as ISO, or undefined when it is not one. */
function instant(raw: string): string | undefined {
  const v = unquote(raw)
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString()
}

/** `<instant>  <from> -> <to>`, the shape a history entry is written in. */
function parseTransition(entry: string): StatusTransition | undefined {
  const arrow = entry.indexOf('->')
  if (arrow < 0) return undefined
  const to = entry.slice(arrow + 2).trim()
  if (!to) return undefined
  const left = entry.slice(0, arrow).trim()
  const dated = /^(\S+)\s+([\s\S]*)$/.exec(left)
  const at = dated ? instant(dated[1]) : undefined
  const from = (at !== undefined ? dated![2] : left).trim()
  return { ...(at !== undefined ? { at } : {}), from, to }
}

/**
 * The facts the document states about itself, or undefined when it states none
 * — no block, or a block holding nothing this reader knows.
 */
export function readDocFrontmatter(body: string): DocFrontmatter | undefined {
  const block = FRONTMATTER.exec(body)
  if (!block) return undefined

  const facts: DocFrontmatter = { statusHistory: [], omittedTransitions: 0 }
  let stated = false
  let key: string | null = null

  for (const line of block[1].split(/\r?\n/)) {
    const item = ITEM.exec(line)
    if (item && key === 'status_history') {
      const entry = unquote(item[1])
      const omitted = OMITTED.exec(entry)
      if (omitted) {
        facts.omittedTransitions += Number(omitted[1])
        stated = true
        continue
      }
      const transition = parseTransition(entry)
      if (transition) {
        facts.statusHistory.push(transition)
        stated = true
      }
      continue
    }
    const scalar = SCALAR.exec(line)
    if (!scalar) continue
    key = scalar[1].trim().toLowerCase().replace(/[ -]/g, '_')
    const raw = scalar[2]
    if (raw.trim() === '') continue
    switch (key) {
      case 'created':
      case 'updated':
      case 'resolved': {
        const at = instant(raw)
        // First statement of a field wins, and an unparseable one is no fact.
        if (at !== undefined && facts[key] === undefined) {
          facts[key] = at
          stated = true
        }
        break
      }
      case 'status': {
        const name = unquote(raw)
        if (name && facts.status === undefined) {
          facts.status = name
          stated = true
        }
        break
      }
      case 'status_category': {
        const bucket = unquote(raw)
        if (bucket && facts.statusCategory === undefined) {
          facts.statusCategory = bucket
          stated = true
        }
        break
      }
    }
  }

  return stated ? facts : undefined
}
