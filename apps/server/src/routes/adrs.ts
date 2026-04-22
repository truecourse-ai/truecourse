/**
 * HTTP routes for the Decisions tab in the web UI.
 *
 * IMPORTANT: These endpoints exist for the web UI only. The CLI (`truecourse adr …`)
 * imports library functions from `@truecourse/server/*` directly; it does not
 * call these HTTP endpoints. Any functionality here must be mirrored in
 * `tools/cli/src/commands/adr/*.ts` via direct library calls.
 *
 * Endpoints (all under `/api/repos/:id/adrs`):
 *
 *   GET    /                         list accepted ADRs
 *   GET    /drafts                   list pending drafts
 *   GET    /stale                    list stale ADRs
 *   GET    /:adrId                   single accepted ADR
 *   POST   /suggest                  kick off a suggest run
 *   POST   /drafts/:draftId/accept   promote draft → ADR-NNNN-<slug>.md
 *   POST   /drafts/:draftId/reject   persist signature, delete draft
 *   POST   /drafts/:draftId/edit     update draft body/entities/etc.
 *   POST   /:adrId/link              add linked node id
 *   DELETE /:adrId/link/:nodeId      remove linked node id
 */

import { randomUUID } from 'node:crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  SuggestAdrsRequestSchema,
  SaveRawMadrRequestSchema,
  LinkAdrRequestSchema,
} from '@truecourse/shared'
import { createAppError } from '../middleware/error.js'
import { resolveProjectForRequest } from '../config/current-project.js'
import { readProjectConfig } from '../config/project-config.js'
import fs from 'node:fs'
import { getAdrDraftPath } from '../config/paths.js'
import {
  appendRejectedSignature,
  captureFragmentSnapshot,
  computeSignature,
  deleteAdrDraft,
  extractFragmentsFromBody,
  findAdrIndexEntryById,
  listAdrDrafts,
  loadAdrById,
  loadAdrByIdWithSource,
  readAdrCorpus,
  readAdrDraft,
  readRejectedSignatures,
  writeAdrCorpus,
  writeAdrDraftRaw,
  writeAdrRaw,
} from '../lib/adr-store.js'
import type { AdrDraft, FragmentSnapshot } from '@truecourse/shared'
import type { Graph } from '../types/snapshot.js'
import { acceptAdrDraft } from '../lib/adr-writer.js'
import { suggestAdrsInProcess } from '../services/llm/adr-suggester.js'
import { createLLMProvider } from '../services/llm/provider.js'
import { readLatest } from '../lib/analysis-store.js'
import { emitAdrSuggestEvent } from '../socket/handlers.js'
import { log, popLogger, pushLogger } from '../lib/logger.js'
import path from 'node:path'

const router: Router = Router()

/**
 * Drafts don't carry captured fragment snapshots (capture happens at accept).
 * But the UI's fragment renderer needs snapshots to display `adr-graph` /
 * `adr-flow` blocks as rich components instead of fallback warnings. Resolve
 * them live against the current LATEST graph so draft previews match what
 * the accepted ADR will look like.
 */
function resolveDraftFragmentsLive(
  draft: AdrDraft,
  graph: Graph | null,
): FragmentSnapshot[] {
  if (!graph) return []
  return extractFragmentsFromBody(draft.madrBody)
    .map((f) => captureFragmentSnapshot(f, graph))
    .filter((s): s is FragmentSnapshot => s !== null)
}

// ---------------------------------------------------------------------------
// GET /adrs — list accepted ADRs
// ---------------------------------------------------------------------------

router.get('/:id/adrs', (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = resolveProjectForRequest(req.params.id as string)
    const corpus = readAdrCorpus(repo.path)
    res.json({ adrs: corpus?.adrs ?? [], generatedAt: corpus?.generatedAt ?? null })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /adrs/drafts — pending review queue
// ---------------------------------------------------------------------------

router.get('/:id/adrs/drafts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = resolveProjectForRequest(req.params.id as string)
    const drafts = listAdrDrafts(repo.path)
    const latest = readLatest(repo.path)
    const graph = latest?.graph ?? null
    res.json({
      drafts: drafts.map((d) => ({
        ...d,
        // Raw .md source for the client's Raw-mode textarea. Read here
        // rather than re-serializing via `serializeAdrDraft` so the user
        // sees the actual bytes on disk (including any formatting quirks
        // the LLM or a previous raw save introduced).
        source: fs.readFileSync(getAdrDraftPath(repo.path, d.id), 'utf-8'),
        fragments: resolveDraftFragmentsLive(d, graph),
      })),
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /adrs/stale — computed stale ADRs
// ---------------------------------------------------------------------------

router.get('/:id/adrs/stale', (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = resolveProjectForRequest(req.params.id as string)
    const corpus = readAdrCorpus(repo.path)
    const stale = corpus?.adrs.filter((a) => a.isStale) ?? []
    res.json({ adrs: stale })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// GET /adrs/:adrId — single ADR
// ---------------------------------------------------------------------------

router.get('/:id/adrs/:adrId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const repo = resolveProjectForRequest(req.params.id as string)
    // Load the full ADR (index entry + MADR sections + raw source). The
    // source feeds the client's Raw mode; sections feed Preview.
    const loaded = loadAdrByIdWithSource(repo.path, req.params.adrId as string)
    if (!loaded) {
      if (!findAdrIndexEntryById(repo.path, req.params.adrId as string)) {
        throw createAppError(`ADR ${req.params.adrId} not found`, 404)
      }
      throw createAppError(
        `ADR ${req.params.adrId} is indexed but its MADR file is missing on disk`,
        410,
      )
    }
    res.json({ adr: { ...loaded.adr, source: loaded.source } })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// POST /adrs/suggest — kick off a suggest run, stream via Socket.io
// ---------------------------------------------------------------------------

router.post(
  '/:id/adrs/suggest',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const body = SuggestAdrsRequestSchema.parse(req.body ?? {})

      const latest = readLatest(repo.path)
      if (!latest) {
        throw createAppError(
          'No analysis found — run `truecourse analyze` (or POST /analyses) first',
          409,
        )
      }

      const config = readProjectConfig(repo.path)
      const maxDrafts = body.max ?? config.adr?.maxDraftsPerRun ?? undefined
      const threshold = body.threshold ?? config.adr?.defaultThreshold ?? undefined

      const corpus = readAdrCorpus(repo.path)
      const runId = randomUUID()

      // Respond immediately — work runs in the background and streams via
      // Socket.io. Errors after this point are caught and emitted as a
      // complete event with accepted=0 so clients can dismiss the spinner.
      res.json({ runId })

      const provider = createLLMProvider()
      provider.setRepoPath(repo.path)

      // Route the suggest run's internal diagnostics into the repo's
      // adr.log for the lifetime of the background task, then pop back
      // to dashboard.log. Matches how the analyze route scopes its logs.
      pushLogger({
        filePath: path.join(repo.path, '.truecourse/logs/adr.log'),
        tee: process.env.TRUECOURSE_DEV === '1',
      })

      void suggestAdrsInProcess({
        repoPath: repo.path,
        graph: latest.graph,
        existingAdrs: corpus?.adrs ?? [],
        rejectedSignatures: readRejectedSignatures(repo.path),
        maxDrafts,
        threshold,
        topicHint: body.topicHint,
        provider,
        onProgress: (event) => emitAdrSuggestEvent(repo.slug, runId, event),
      })
        .catch((err) => {
          log.error(`[adrs] suggest run ${runId} failed: ${err instanceof Error ? err.message : String(err)}`)
          emitAdrSuggestEvent(repo.slug, runId, { kind: 'complete', accepted: 0, dropped: 0 })
        })
        .finally(() => {
          popLogger()
        })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /adrs/drafts/:draftId/accept
// ---------------------------------------------------------------------------

router.post(
  '/:id/adrs/drafts/:draftId/accept',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const draft = readAdrDraft(repo.path, req.params.draftId as string)
      if (!draft) throw createAppError(`Draft ${req.params.draftId} not found`, 404)

      const config = readProjectConfig(repo.path)
      const outputDir = config.adr?.path
        ? resolveOutputDir(repo.path, config.adr.path)
        : undefined

      const { adr, filePath } = await acceptAdrDraft({
        repoPath: repo.path,
        draft,
        outputDir,
      })
      res.json({ adr, filePath })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /adrs/drafts/:draftId/reject
// ---------------------------------------------------------------------------

router.post(
  '/:id/adrs/drafts/:draftId/reject',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const draft = readAdrDraft(repo.path, req.params.draftId as string)
      if (!draft) throw createAppError(`Draft ${req.params.draftId} not found`, 404)

      const signature = computeSignature(draft)
      appendRejectedSignature(repo.path, signature)
      deleteAdrDraft(repo.path, draft.id)

      res.json({ signature })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// PUT /adrs/drafts/:draftId — replace the full MADR text
// ---------------------------------------------------------------------------

router.put(
  '/:id/adrs/drafts/:draftId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const existing = readAdrDraft(repo.path, req.params.draftId as string)
      if (!existing) throw createAppError(`Draft ${req.params.draftId} not found`, 404)

      const { source } = SaveRawMadrRequestSchema.parse(req.body ?? {})
      const parsed = writeAdrDraftRaw(repo.path, req.params.draftId as string, source)
      const graph = readLatest(repo.path)?.graph ?? null
      res.json({
        draft: {
          ...parsed,
          source,
          fragments: resolveDraftFragmentsLive(parsed, graph),
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// PUT /adrs/:adrId — replace the full MADR text for an accepted ADR
// ---------------------------------------------------------------------------

router.put(
  '/:id/adrs/:adrId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const { source } = SaveRawMadrRequestSchema.parse(req.body ?? {})
      writeAdrRaw(repo.path, req.params.adrId as string, source)
      const loaded = loadAdrByIdWithSource(repo.path, req.params.adrId as string)
      if (!loaded) throw createAppError(`ADR ${req.params.adrId} not found`, 404)
      res.json({ adr: { ...loaded.adr, source: loaded.source } })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /adrs/:adrId/link — add linked node id
// DELETE /adrs/:adrId/link/:nodeId — remove linked node id
// ---------------------------------------------------------------------------

router.post(
  '/:id/adrs/:adrId/link',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const { nodeId } = LinkAdrRequestSchema.parse(req.body ?? {})
      const updated = mutateAdrLinks(repo.path, req.params.adrId as string, (links) =>
        Array.from(new Set([...links, nodeId])),
      )
      res.json({ adr: updated })
    } catch (err) {
      next(err)
    }
  },
)

router.delete(
  '/:id/adrs/:adrId/link/:nodeId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const repo = resolveProjectForRequest(req.params.id as string)
      const nodeId = req.params.nodeId as string
      const updated = mutateAdrLinks(repo.path, req.params.adrId as string, (links) =>
        links.filter((id) => id !== nodeId),
      )
      res.json({ adr: updated })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mutateAdrLinks(
  repoPath: string,
  adrId: string,
  transform: (links: string[]) => string[],
) {
  const corpus = readAdrCorpus(repoPath)
  if (!corpus) throw createAppError('No ADR corpus found', 404)
  const idx = corpus.adrs.findIndex((a) => a.id === adrId)
  if (idx === -1) throw createAppError(`ADR ${adrId} not found`, 404)
  const updated = { ...corpus.adrs[idx]! }
  updated.linkedNodeIds = transform(updated.linkedNodeIds)
  corpus.adrs[idx] = updated
  writeAdrCorpus(repoPath, { ...corpus, generatedAt: new Date().toISOString() })
  return updated
}

function resolveOutputDir(repoPath: string, configured: string): string {
  // Accept absolute paths as-is; relative paths join against the repo root.
  if (configured.startsWith('/')) return configured
  return `${repoPath}/${configured}`
}

export default router
