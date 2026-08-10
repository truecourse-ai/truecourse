// Genuine callback hell: four levels of nested, block-bodied callbacks doing
// sequential work. This is the pattern the rule is meant to catch.

function readSettings(cb: (value: number) => void): void {
  cb(1)
}

function fetchRows(seed: number, cb: (rows: number[]) => void): void {
  cb([seed, seed + 1])
}

export function startPipeline(
  events: { on: (name: string, handler: () => void) => void },
  sink: number[],
): void {
  events.on('start', () => {
    setTimeout(() => {
      readSettings((seed) => {
        // VIOLATION: code-quality/deterministic/deep-callback-nesting
        fetchRows(seed, (rows) => {
          sink.push(rows.length)
        })
      })
    }, 25)
  })
}
