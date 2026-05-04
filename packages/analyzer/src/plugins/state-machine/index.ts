import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import type { Invariant, InvariantDraft, Violation } from '@truecourse/shared'
import type {
  Plugin,
  DiscoverContext,
  EnforceContext,
  EstimateContext,
  InvariantEnforceEstimate,
} from '../types.js'
import {
  StateMachineDeclarationSchema,
  buildTransitionSet,
  type StateMachineDeclaration,
} from './schema.js'
import { buildDiscoveryPrompt, type DiscoveryPromptInput } from './prompts.js'
import {
  findStringLiteralUnions,
  findFieldWriteSites,
  inferPriorStates,
  type WriteSite,
  type UnionTypeDecl,
} from './ast.js'
import { parseFile } from '../../parser.js'
import { detectLanguage } from '../../language-config.js'
import type { SupportedLanguage } from '@truecourse/shared'

const TYPE = 'state-machine'
const VERSION = 1

// ---------------------------------------------------------------------------
// LLM I/O schema for discovery
// ---------------------------------------------------------------------------
//
// Single call per candidate. Two response shapes via discriminator:
//   - `{ isStateMachine: false, reason }`              → drop the candidate
//   - `{ isStateMachine: true, states, terminal, … }`  → emit a draft
//
// Anthropic CLI tool schemas reject top-level discriminated unions, so we
// flatten the union into a single object with optional fields and validate
// the conditional shape after the call returns.
// ---------------------------------------------------------------------------

const DiscoveryResponseSchema = z.object({
  isStateMachine: z.boolean(),
  reason: z.string().optional(),
  states: z.array(z.string()).optional(),
  terminal: z.array(z.string()).optional(),
  initial: z.array(z.string()).optional(),
  transitions: z
    .array(z.object({ from: z.string(), to: z.string() }))
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
})

const CONFIDENCE_THRESHOLD = 0.5
const MAX_DRAFTS_PER_RUN = 10

// ---------------------------------------------------------------------------
// Discover
// ---------------------------------------------------------------------------

interface CandidateContext {
  ownerName: string
  fieldName: string
  unionDecl: UnionTypeDecl & { filePath: string }
  /** Files that contain at least one write site for this field. */
  writeSiteFiles: Map<string, WriteSite[]>
}

async function discover(ctx: DiscoverContext): Promise<InvariantDraft[]> {
  // ---- Step 1. Find every string-literal union type alias in the repo -----
  const unionsByName = new Map<string, UnionTypeDecl & { filePath: string }>()
  const tsFiles: Array<{ filePath: string; language: SupportedLanguage; source: string }> = []

  for (const f of ctx.files) {
    const language = detectLanguage(f.filePath)
    if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') continue
    const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(ctx.repoPath, f.filePath)
    let source: string
    try {
      source = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    tsFiles.push({ filePath: abs, language, source })
    let tree
    try {
      tree = parseFile(abs, source, language)
    } catch {
      continue
    }
    for (const u of findStringLiteralUnions(tree, source)) {
      // Last write wins for duplicate names — the plugin can only key by
      // type name in v1; cross-file duplicates with different members are
      // uncommon and would need the type-checker to disambiguate.
      unionsByName.set(u.name, { ...u, filePath: abs })
    }
  }

  if (unionsByName.size === 0) return []

  // ---- Step 2. For each union, find candidate fields typed by it ---------
  // We use a heuristic match: a class/interface property whose annotation
  // text equals the union name (modulo whitespace) is treated as typed by
  // that union. Exposes some misses (Pick<Status>, type aliases) — TODO v2.
  const candidates: CandidateContext[] = []
  for (const [unionName, decl] of unionsByName) {
    const owners = collectFieldOwners(ctx.files, unionName)
    for (const { ownerName, fieldName } of owners) {
      const writeSiteFiles = new Map<string, WriteSite[]>()
      for (const tf of tsFiles) {
        let tree
        try {
          tree = parseFile(tf.filePath, tf.source, tf.language)
        } catch {
          continue
        }
        const sites = findFieldWriteSites(tree, tf.source, fieldName)
          .filter((s) => receiverMatchesOwner(s.receiver, ownerName))
        if (sites.length > 0) writeSiteFiles.set(tf.filePath, sites)
      }
      if (writeSiteFiles.size === 0) continue
      candidates.push({ ownerName, fieldName, unionDecl: decl, writeSiteFiles })
    }
  }

  // ---- Step 3. For each candidate, build observed graph + ask the LLM ----
  const drafts: InvariantDraft[] = []
  let total = candidates.length
  for (let i = 0; i < candidates.length; i++) {
    if (drafts.length >= MAX_DRAFTS_PER_RUN) break
    const c = candidates[i]
    const scope = `${c.ownerName}.${c.fieldName}`

    ctx.report?.({
      kind: 'plugin-progress',
      plugin: TYPE,
      current: i + 1,
      total,
      label: scope,
    })

    const observed = summarizeObservations(c)
    const relevantSpecSections = pickRelevantSpecSections(ctx.spec.sections, c.unionDecl.states, c.fieldName, c.ownerName)

    // Cheap pre-filter: state machines worth declaring almost always have
    // spec coverage. Without any spec context, the LLM has nothing to
    // ground its yes/no judgment on — so the call costs ~$0.01 and
    // overwhelmingly returns 'ad-hoc enum' for arbitrary `Status` /
    // `HttpMethod` / `LogLevel` / `Tier` types. Skip the call when no
    // spec section even mentions the candidate's field, owner, or any
    // state value. Reduces cost dramatically on real codebases.
    if (relevantSpecSections.length === 0) {
      continue
    }

    const promptInput: DiscoveryPromptInput = {
      scope,
      states: c.unionDecl.states,
      observedTransitions: observed.transitions,
      observedUnguardedTargets: observed.unguarded,
      observedInitialTargets: observed.initial,
      relevantSpecSections,
    }

    let response: z.infer<typeof DiscoveryResponseSchema>
    try {
      response = await ctx.llm.run({
        prompt: buildDiscoveryPrompt(promptInput),
        schema: DiscoveryResponseSchema,
        label: `${TYPE}-discover`,
      })
    } catch (err) {
      console.warn(`[state-machine] discover failed for ${scope}: ${(err as Error).message}`)
      continue
    }

    if (!response.isStateMachine) continue
    if ((response.confidence ?? 0) < CONFIDENCE_THRESHOLD) continue
    if (!response.states || response.states.length === 0) continue
    if (!response.transitions || !response.initial) continue

    // Validate the LLM output against the canonical schema. Drop on failure
    // (the LLM emitted something we can't store as-is).
    const declaration: StateMachineDeclaration = {
      scope,
      obligationKey: scope,
      states: response.states,
      terminal: response.terminal ?? [],
      initial: response.initial,
      transitions: response.transitions,
    }
    const parsed = StateMachineDeclarationSchema.safeParse(declaration)
    if (!parsed.success) {
      console.warn(`[state-machine] LLM output failed schema validation for ${scope}: ${parsed.error.message}`)
      continue
    }

    drafts.push({
      id: crypto.randomUUID(),
      type: TYPE,
      pluginVersion: VERSION,
      scope,
      declaration: parsed.data,
      provenance: {
        source: 'discovered',
        inputs: ['code', 'spec'],
        timestamp: new Date().toISOString(),
        signal:
          `union ${c.unionDecl.name} declared at ` +
          `${path.relative(ctx.repoPath, c.unionDecl.filePath ?? '?')}:${c.unionDecl.line}; ` +
          `${observed.transitions.length} observed transition(s) across ${c.writeSiteFiles.size} file(s)`,
      },
      rationale: response.rationale ?? '(no rationale)',
      confidence: response.confidence ?? CONFIDENCE_THRESHOLD,
    })
  }

  return drafts
}

// ---------------------------------------------------------------------------
// Owner / receiver matching helpers
// ---------------------------------------------------------------------------
//
// Owner detection: find every class/interface property whose annotation
// text equals the union type name. v1 reads only `FileAnalysis.classes`
// (interfaces aren't extracted today); we re-parse to pick up interface
// property signatures.
// ---------------------------------------------------------------------------

interface FieldOwner {
  ownerName: string
  fieldName: string
}

function collectFieldOwners(files: { filePath: string }[], unionName: string): FieldOwner[] {
  const out: FieldOwner[] = []
  for (const f of files) {
    const language = detectLanguage(f.filePath)
    if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') continue
    let source: string
    try {
      source = fs.readFileSync(f.filePath, 'utf-8')
    } catch {
      continue
    }
    let tree
    try {
      tree = parseFile(f.filePath, source, language)
    } catch {
      continue
    }
    out.push(...collectFieldOwnersFromTree(tree.rootNode, source, unionName))
  }
  return dedupeOwners(out)
}

function collectFieldOwnersFromTree(
  rootNode: import('web-tree-sitter').Node,
  sourceCode: string,
  unionName: string,
): FieldOwner[] {
  const out: FieldOwner[] = []
  const visit = (node: import('web-tree-sitter').Node): void => {
    if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        const ownerName = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
        const body = node.childForFieldName('body')
        if (body) {
          for (const member of body.namedChildren) {
            const fieldName = readFieldOfType(member, sourceCode, unionName)
            if (fieldName) out.push({ ownerName, fieldName })
          }
        }
      }
    }
    for (const c of node.namedChildren) visit(c)
  }
  visit(rootNode)
  return out
}

function readFieldOfType(
  member: import('web-tree-sitter').Node,
  sourceCode: string,
  unionName: string,
): string | null {
  // class field:    public_field_definition / property_signature
  // interface:      property_signature
  if (
    member.type !== 'public_field_definition' &&
    member.type !== 'property_signature'
  ) return null
  const nameNode = member.childForFieldName('name')
  const typeNode = member.childForFieldName('type')
  if (!nameNode || !typeNode) return null
  const name = sourceCode.slice(nameNode.startIndex, nameNode.endIndex)
  // typeNode is a `type_annotation` whose first named child is the actual type.
  const annotated = typeNode.namedChildren[0]
  if (!annotated) return null
  const text = sourceCode.slice(annotated.startIndex, annotated.endIndex).trim()
  if (text === unionName) return name
  return null
}

function dedupeOwners(rows: FieldOwner[]): FieldOwner[] {
  const seen = new Set<string>()
  const out: FieldOwner[] = []
  for (const r of rows) {
    const k = `${r.ownerName}.${r.fieldName}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

/**
 * v1 receiver-match heuristic: a write `<receiver>.<field> = ...` is in
 * scope of `<owner>.<field>` when the receiver's identifier name shares a
 * lowercased substring with the owner name. e.g. `step` matches `Step`,
 * `currentStep` matches `Step`, `prevStep` matches `Step`. Generic names
 * (`s`, `obj`, `record`) don't match — known limitation, surfaced in plugin
 * docs.
 */
function receiverMatchesOwner(receiver: string | null, owner: string): boolean {
  if (receiver === null) return true // initial-shape writes have no receiver
  return receiver.toLowerCase().includes(owner.toLowerCase())
}

// ---------------------------------------------------------------------------
// Observation summarization
// ---------------------------------------------------------------------------

interface Observations {
  transitions: Array<{ from: string; to: string }>
  unguarded: string[]
  initial: string[]
}

function summarizeObservations(c: CandidateContext): Observations {
  const transitions = new Set<string>()
  const unguarded = new Set<string>()
  const initial = new Set<string>()

  for (const [filePath, sites] of c.writeSiteFiles) {
    for (const site of sites) {
      if (site.value === null) continue
      if (site.kind === 'initial') {
        initial.add(site.value)
        continue
      }
      let source = ''
      try {
        source = fs.readFileSync(filePath, 'utf-8')
      } catch {
        continue
      }
      const inference = inferPriorStates(site, source)
      if (inference.kind === 'guarded') {
        for (const p of inference.priors) transitions.add(`${p}|${site.value}`)
      } else {
        unguarded.add(site.value)
      }
    }
  }

  return {
    transitions: [...transitions].map((k) => {
      const [from, to] = k.split('|')
      return { from, to }
    }),
    unguarded: [...unguarded],
    initial: [...initial],
  }
}

function pickRelevantSpecSections(
  sections: import('../types.js').SpecSection[],
  states: string[],
  fieldName: string,
  ownerName: string,
): import('../types.js').SpecSection[] {
  const needles = [...states, fieldName, ownerName].map((s) => s.toLowerCase())
  return sections.filter((s) => {
    const haystack = s.content.toLowerCase()
    return needles.some((n) => haystack.includes(n))
  })
}

// ---------------------------------------------------------------------------
// Enforce — fully deterministic, zero LLM
// ---------------------------------------------------------------------------

async function enforce(invariant: Invariant, ctx: EnforceContext): Promise<Violation[]> {
  const declaration = invariant.declaration as StateMachineDeclaration
  const [ownerName, fieldName] = declaration.scope.split('.')
  if (!ownerName || !fieldName) return []

  const transitionSet = buildTransitionSet(declaration)
  const allowedInitial = new Set(declaration.initial)

  const violations: Violation[] = []

  for (const f of ctx.files) {
    const language = detectLanguage(f.filePath)
    if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') continue
    const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(ctx.repoPath, f.filePath)
    let source: string
    try {
      source = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    let tree
    try {
      tree = parseFile(abs, source, language)
    } catch {
      continue
    }

    const sites = findFieldWriteSites(tree, source, fieldName)
      .filter((s) => receiverMatchesOwner(s.receiver, ownerName))

    for (const site of sites) {
      if (site.value === null) continue
      const violation = checkSite(site, source, transitionSet, allowedInitial, declaration, abs, invariant.id)
      if (violation) violations.push(violation)
    }
  }

  return violations
}

function checkSite(
  site: WriteSite,
  source: string,
  transitionSet: Set<string>,
  allowedInitial: Set<string>,
  declaration: StateMachineDeclaration,
  filePath: string,
  invariantId: string,
): Violation | null {
  const newState = site.value!
  if (!declaration.states.includes(newState)) {
    // Unknown literal — could be a typo, but more often it's a state added
    // to code without updating the invariant. Stale-detection territory;
    // not an enforcement violation.
    return null
  }

  if (site.kind === 'initial') {
    if (allowedInitial.has(newState)) return null
    return makeViolation({
      title: `Illegal initial state: ${newState}`,
      content:
        `Initial write of \`${declaration.scope}\` to '${newState}' is not in the declared ` +
        `initial set [${[...allowedInitial].join(', ')}].`,
      fixSuggestion:
        `Change the initial value to one of [${[...allowedInitial].join(', ')}], ` +
        `or extend the invariant's \`initial\` set if '${newState}' is a legitimate creation state.`,
      site,
      filePath,
      invariantId,
    })
  }

  const inference = inferPriorStates(site, source)

  if (inference.kind === 'guarded') {
    const illegal = inference.priors.filter((p) => !transitionSet.has(`${p}|${newState}`))
    if (illegal.length === 0) return null
    return makeViolation({
      title: `Illegal transition to ${newState}`,
      content:
        `Write to \`${declaration.scope}\` = '${newState}' from prior state(s) [${illegal.join(', ')}]. ` +
        `Declared transitions do not allow ${illegal.map((p) => `${p} → ${newState}`).join(', ')}.`,
      fixSuggestion:
        `Either guard this write with a stricter precondition (allowed prior states: ` +
        `${suggestAllowedPriors(declaration, newState).join(', ') || '(none)'}), ` +
        `or extend the invariant's transitions if these moves are legitimate.`,
      site,
      filePath,
      invariantId,
    })
  }

  // Unguarded write rule (v1, conservative):
  //   • Skip when the target itself is terminal — terminal-targeted writes
  //     are usually legitimate end-of-pipeline finalizers ("mark as done").
  //   • Otherwise flag iff at least one declared terminal state has NO
  //     transition to `newState`. That's the regression-out-of-terminal
  //     pattern (the headline class of bug — a finished record being
  //     dragged back into an active state by a guard-less recovery path).
  // Other unguarded transitions (e.g. forward moves between active states)
  // are deliberately not flagged here — too noisy without prior-state
  // context. The user can author additional transitions or hand-author
  // tighter invariants if they want to catch those.
  if (declaration.terminal.includes(newState)) return null
  const offendingTerminals = declaration.terminal.filter(
    (t) => !transitionSet.has(`${t}|${newState}`),
  )
  if (offendingTerminals.length === 0) return null

  return makeViolation({
    title: `Unguarded write to ${newState}`,
    content:
      `Unguarded write to \`${declaration.scope}\` = '${newState}'. ` +
      `Terminal state(s) [${offendingTerminals.join(', ')}] have no declared transition to '${newState}', ` +
      `so this write could regress a finished record back into an active state.`,
    fixSuggestion:
      `Add a precondition that excludes the terminal state(s) ` +
      `(e.g. \`if (x.${declaration.scope.split('.')[1]} !== '${offendingTerminals[0]}')\`) ` +
      `before this write, or extend the invariant if the transition is intentional.`,
    site,
    filePath,
    invariantId,
  })
}

function suggestAllowedPriors(decl: StateMachineDeclaration, target: string): string[] {
  const out: string[] = []
  for (const t of decl.transitions) {
    const tos = Array.isArray(t.to) ? t.to : [t.to]
    if (!tos.includes(target)) continue
    const froms = Array.isArray(t.from) ? t.from : [t.from]
    out.push(...froms)
  }
  return [...new Set(out)]
}

function makeViolation(args: {
  title: string
  content: string
  fixSuggestion: string
  site: WriteSite
  filePath: string
  invariantId: string
}): Violation {
  return {
    id: crypto.randomUUID(),
    type: 'invariant',
    title: args.title,
    content: args.content,
    severity: 'high',
    invariantId: args.invariantId,
    enforcement: 'deterministic',
    fixPrompt: args.fixSuggestion,
    createdAt: new Date().toISOString(),
    filePath: args.filePath,
    lineStart: args.site.lineStart,
    lineEnd: args.site.lineEnd,
  }
}

// ---------------------------------------------------------------------------
// Estimate — zero LLM cost (deterministic enforce)
// ---------------------------------------------------------------------------

function estimateEnforce(
  _invariant: Invariant,
  _ctx: EstimateContext,
): InvariantEnforceEstimate {
  return { llmCalls: 0, estimatedTokens: 0 }
}

// ---------------------------------------------------------------------------
// Anchor check — does the declared union type still exist anywhere?
// ---------------------------------------------------------------------------

function checkAnchor(invariant: Invariant, ctx: DiscoverContext): 'present' | 'missing' {
  const declaration = invariant.declaration as StateMachineDeclaration
  const [ownerName, fieldName] = declaration.scope.split('.')
  if (!ownerName || !fieldName) return 'missing'

  for (const f of ctx.files) {
    const language = detectLanguage(f.filePath)
    if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') continue
    const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(ctx.repoPath, f.filePath)
    let source: string
    try {
      source = fs.readFileSync(abs, 'utf-8')
    } catch {
      continue
    }
    let tree
    try {
      tree = parseFile(abs, source, language)
    } catch {
      continue
    }
    let found = false
    const visit = (node: import('web-tree-sitter').Node): void => {
      if (found) return
      if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
        const nameNode = node.childForFieldName('name')
        if (nameNode && source.slice(nameNode.startIndex, nameNode.endIndex) === ownerName) {
          const body = node.childForFieldName('body')
          if (body) {
            for (const m of body.namedChildren) {
              if (
                (m.type === 'public_field_definition' || m.type === 'property_signature') &&
                m.childForFieldName('name') &&
                source.slice(m.childForFieldName('name')!.startIndex, m.childForFieldName('name')!.endIndex) === fieldName
              ) {
                found = true
                return
              }
            }
          }
        }
      }
      for (const c of node.namedChildren) {
        if (found) return
        visit(c)
      }
    }
    visit(tree.rootNode)
    if (found) return 'present'
  }
  return 'missing'
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const stateMachinePlugin: Plugin = {
  type: TYPE,
  version: VERSION,
  metadata: {
    name: 'State Machine',
    description:
      'Enforces declared state-machine transitions on a typed field. Walks every write site (direct assignment + initial-shape object literals), infers possible prior states from surrounding `if (x.field === \'literal\')` guards, and flags writes whose `(prior, new)` pair is not in the declared transitions. Discovery extracts string-literal union types and asks the LLM whether each candidate is a real state machine vs. an ad-hoc enum. Enforcement is fully deterministic — no LLM calls.',
    enforcement: 'deterministic',
    defaultSeverity: 'high',
  },
  declarationSchema: StateMachineDeclarationSchema,
  discover,
  enforce,
  estimateEnforce,
  checkAnchor,
}
