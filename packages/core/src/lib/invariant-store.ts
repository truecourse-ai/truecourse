import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  InvariantSchema,
  InvariantDraftSchema,
  RejectedDraftSchema,
  InvariantCheckpointSchema,
  type Invariant,
  type InvariantDraft,
  type RejectedDraft,
  type InvariantCheckpoint,
} from '@truecourse/shared'
import { atomicWriteJson } from './atomic-write.js'

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
//
// <repo>/.truecourse/
//   invariants/<slug>.yaml         active invariants  (committed)
//   invariant-drafts/<id>.json     pending review     (gitignored)
//   invariant-rejected.json        rejected sigs      (committed)
//   invariant-checkpoint.json      diff-mode state    (committed)
// ---------------------------------------------------------------------------

const TRUECOURSE_DIR = '.truecourse'
const INVARIANTS_DIR = 'invariants'
const DRAFTS_DIR = 'invariant-drafts'
const REJECTED_FILE = 'invariant-rejected.json'
const CHECKPOINT_FILE = 'invariant-checkpoint.json'

function storeDir(repoPath: string): string {
  return path.join(repoPath, TRUECOURSE_DIR)
}

export function invariantsDir(repoPath: string): string {
  return path.join(storeDir(repoPath), INVARIANTS_DIR)
}

export function draftsDir(repoPath: string): string {
  return path.join(storeDir(repoPath), DRAFTS_DIR)
}

export function rejectedPath(repoPath: string): string {
  return path.join(storeDir(repoPath), REJECTED_FILE)
}

export function checkpointPath(repoPath: string): string {
  return path.join(storeDir(repoPath), CHECKPOINT_FILE)
}

export function invariantYamlPath(repoPath: string, slug: string): string {
  return path.join(invariantsDir(repoPath), `${slug}.yaml`)
}

export function draftJsonPath(repoPath: string, draftId: string): string {
  return path.join(draftsDir(repoPath), `${draftId}.json`)
}

// ---------------------------------------------------------------------------
// Atomic YAML write (mirrors atomicWriteJson)
// ---------------------------------------------------------------------------

function atomicWriteYaml(targetPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, yaml.dump(data, { lineWidth: 100, noRefs: true }))
  fs.renameSync(tmp, targetPath)
}

// ---------------------------------------------------------------------------
// Active invariants — YAML files
// ---------------------------------------------------------------------------

export function listActiveInvariantSlugs(repoPath: string): string[] {
  const dir = invariantsDir(repoPath)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.ya?ml$/, ''))
}

export function readActiveInvariant(repoPath: string, slug: string): Invariant | null {
  const file = invariantYamlPath(repoPath, slug)
  if (!fs.existsSync(file)) return null
  let raw: unknown
  try {
    raw = yaml.load(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    throw new Error(`Invalid invariant at ${file}: ${(err as Error).message}`)
  }
  const parsed = InvariantSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid invariant at ${file}: ${parsed.error.message}`)
  }
  return { ...parsed.data, sourceFile: path.relative(repoPath, file) }
}

export function readAllActiveInvariants(repoPath: string): Invariant[] {
  const out: Invariant[] = []
  for (const slug of listActiveInvariantSlugs(repoPath)) {
    const inv = readActiveInvariant(repoPath, slug)
    if (inv) out.push(inv)
  }
  return out
}

export function writeActiveInvariant(repoPath: string, slug: string, invariant: Invariant): void {
  // Re-validate the envelope before writing — guards against malformed callers.
  const parsed = InvariantSchema.parse(invariant)
  atomicWriteYaml(invariantYamlPath(repoPath, slug), parsed)
}

export function retireInvariant(repoPath: string, slug: string): boolean {
  const file = invariantYamlPath(repoPath, slug)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  return true
}

// ---------------------------------------------------------------------------
// Drafts — JSON files
// ---------------------------------------------------------------------------

export function listDrafts(repoPath: string): InvariantDraft[] {
  const dir = draftsDir(repoPath)
  if (!fs.existsSync(dir)) return []
  const out: InvariantDraft[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'))
    } catch {
      continue // malformed JSON — skip
    }
    const parsed = InvariantDraftSchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function readDraft(repoPath: string, draftId: string): InvariantDraft | null {
  const file = draftJsonPath(repoPath, draftId)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
  const parsed = InvariantDraftSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid draft at ${file}: ${parsed.error.message}`)
  }
  return parsed.data
}

export function writeDraft(repoPath: string, draft: InvariantDraft): void {
  const validated = InvariantDraftSchema.parse(draft)
  atomicWriteJson(draftJsonPath(repoPath, validated.id), validated)
}

export function deleteDraft(repoPath: string, draftId: string): boolean {
  const file = draftJsonPath(repoPath, draftId)
  if (!fs.existsSync(file)) return false
  fs.unlinkSync(file)
  return true
}

export function clearAllDrafts(repoPath: string): void {
  const dir = draftsDir(repoPath)
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.json')) fs.unlinkSync(path.join(dir, file))
  }
}

// ---------------------------------------------------------------------------
// Rejected signatures
// ---------------------------------------------------------------------------

export function readRejected(repoPath: string): RejectedDraft[] {
  const file = rejectedPath(repoPath)
  if (!fs.existsSync(file)) return []
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry) => RejectedDraftSchema.safeParse(entry))
    .filter((p): p is { success: true; data: RejectedDraft } => p.success)
    .map((p) => p.data)
}

export function appendRejected(repoPath: string, entry: RejectedDraft): void {
  const validated = RejectedDraftSchema.parse(entry)
  const existing = readRejected(repoPath)
  // Dedupe by signature
  const filtered = existing.filter((e) => e.signature !== validated.signature)
  filtered.push(validated)
  atomicWriteJson(rejectedPath(repoPath), filtered)
}

export function rejectedSignatureSet(repoPath: string): Set<string> {
  return new Set(readRejected(repoPath).map((e) => e.signature))
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

export function readCheckpoint(repoPath: string): InvariantCheckpoint | null {
  const file = checkpointPath(repoPath)
  if (!fs.existsSync(file)) return null
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown
  const parsed = InvariantCheckpointSchema.safeParse(raw)
  if (!parsed.success) return null
  return parsed.data
}

export function writeCheckpoint(repoPath: string, checkpoint: InvariantCheckpoint): void {
  const validated = InvariantCheckpointSchema.parse(checkpoint)
  atomicWriteJson(checkpointPath(repoPath), validated)
}
