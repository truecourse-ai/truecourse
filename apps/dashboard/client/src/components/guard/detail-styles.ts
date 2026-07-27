/**
 * The mono code-block class every guard detail pane shares (expected/actual,
 * evidence, step output, the file's own text). One definition — the five detail
 * components carried verbatim copies before it was hoisted here.
 *
 * Program output is never re-wrapped: a wrapped log line, command or JSON body
 * lies about its shape, so the block keeps `whitespace-pre` and scrolls
 * HORIZONTALLY on its own — the one scroll a detail pane sanctions, because the
 * pane cannot carry it.
 *
 * VERTICALLY it never scrolls: the pane is the only scroll context for height.
 * Long data is CLAMPED to a head and grown inline ({@link GuardLongText}), so the
 * page grows and the block never gets its own vertical scrollbar.
 *
 * `max-w-full` is what keeps that sideways scroll INSIDE the block: without it a
 * block laid out as a flex item takes its content's width and stretches the pane
 * instead, and the reader ends up scrolling the whole page sideways.
 */
export const PRE =
  'mt-1 max-w-full overflow-x-auto whitespace-pre rounded border border-border bg-muted/20 p-2 font-mono text-[11px] text-foreground';
