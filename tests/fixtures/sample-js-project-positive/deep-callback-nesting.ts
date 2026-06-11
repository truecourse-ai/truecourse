// Trivial leaf callbacks nested inside other callbacks — concise `.map`
// transforms and no-op cleanups — are not callback hell and must not be
// flagged, even when several callback layers sit above them.

interface Row {
  id: string
  price: number
}

function withSpan(fn: (span: { payload: unknown }) => void): void {
  fn({ payload: null })
}

export function buildReport(
  source: { on: (name: string, handler: () => void) => void },
  rows: readonly Row[],
): void {
  source.on('refresh', () => {
    queueMicrotask(() => {
      withSpan((span) => {
        span.payload = {
          // Concise expression-bodied transforms — not nesting depth.
          prices: rows.map((r) => ({ ...r, price: Number(r.price) })),
          ids: rows.map((r) => r.id),
        }
      })
    })
  })
}

function defer(fn: () => void): void {
  fn()
}

function flush(fn: () => void): void {
  fn()
}

function removeTemp(fn: () => void): void {
  fn()
}

export function cleanupLater(
  watcher: { on: (name: string, handler: () => void) => void },
): void {
  watcher.on('done', () => {
    defer(() => {
      flush(() => {
        // No-op cleanup callback nested deeply — still not callback hell.
        removeTemp(() => {})
      })
    })
  })
}
