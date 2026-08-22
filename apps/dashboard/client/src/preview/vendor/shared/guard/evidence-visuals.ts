// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/guard/evidence-visuals.ts; delete with the preview.
/**
 * The VISUAL half of an evidence bundle: the per-step screenshots and the session
 * video a browser run leaves next to `transcript.txt`.
 *
 * A web step spawns nothing, it has no exit code and no streams, so what it did is
 * only readable as a picture. The web driver writes one `step-<n>.png` per executed
 * step and one `session.webm` for the whole session into the scenario's evidence
 * directory; this module is the ONE place that reads meaning out of those names, so
 * the server (which lists and serves them) and the client (which renders them) can
 * never disagree about what a file is or where it belongs.
 *
 * Classification is by EXTENSION, not by exact filename: a `.png` in the bundle is a
 * screenshot and a `.webm` is the session video, whatever they end up being called.
 * Only the STEP INDEX is name-derived (`step-3.png` → step 3), and only when the name
 * carries one, a visual that names no step is still a visual.
 *
 * A bundle from a cli/api run holds none of these, and every read here answers with
 * an empty list for it. Nothing about the pre-web evidence shape changes.
 */

export type GuardEvidenceVisualKind = 'screenshot' | 'video'

/** ONE visual artifact in a scenario's evidence directory. */
export interface GuardEvidenceVisual {
  /** The file's own name inside the evidence dir, how the serve route addresses it. */
  file: string
  kind: GuardEvidenceVisualKind
  /** 1-based step index, when the name carries one; absent when it does not. */
  step?: number
}

/** Extension → what that artifact IS. The whole vocabulary of visual evidence. */
const VISUAL_KIND_BY_EXT: Readonly<Record<string, GuardEvidenceVisualKind>> = {
  '.png': 'screenshot',
  '.webm': 'video',
}

/** What each kind is served as. One kind, one media type, no sniffing anywhere. */
export const GUARD_VISUAL_CONTENT_TYPE: Readonly<Record<GuardEvidenceVisualKind, string>> = {
  screenshot: 'image/png',
  video: 'video/webm',
}

/** `step-12.png` → 12. Anything else carries no step. */
function stepIndexOf(file: string): number | undefined {
  const m = /^step-(\d+)\./.exec(file)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/**
 * Read one evidence filename as a visual, or `null` when it is not one (a transcript,
 * `invocation.json`, anything with a separator in it, a plain segment is the only
 * thing an evidence directory holds).
 */
export function guardEvidenceVisual(file: string): GuardEvidenceVisual | null {
  if (!file || file.includes('/') || file.includes('\\')) return null
  const dot = file.lastIndexOf('.')
  if (dot <= 0) return null
  const kind = VISUAL_KIND_BY_EXT[file.slice(dot).toLowerCase()]
  if (!kind) return null
  const step = stepIndexOf(file)
  return { file, kind, ...(step !== undefined ? { step } : {}) }
}

/**
 * The bundle's visuals IN READING ORDER: the screenshots in step order first (a
 * stepless one after the numbered ones, by name), then the session video, the order
 * a reader walks a browser run in, so the renderer never has to re-sort.
 */
export function guardEvidenceVisuals(files: readonly string[]): GuardEvidenceVisual[] {
  const visuals = files
    .map(guardEvidenceVisual)
    .filter((v): v is GuardEvidenceVisual => v !== null)
  return visuals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'screenshot' ? -1 : 1
    if (a.step !== b.step) {
      if (a.step === undefined) return 1
      if (b.step === undefined) return -1
      return a.step - b.step
    }
    return a.file.localeCompare(b.file)
  })
}
