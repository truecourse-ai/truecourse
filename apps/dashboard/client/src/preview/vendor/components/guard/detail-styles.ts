import { ARTIFACT_PRE } from '@/preview/ui/artifact-view';

/**
 * The mono code-block class every guard detail pane shares (expected/actual,
 * evidence, step output, the file's own text), the SAME class the shared raw
 * artifact pane uses, so a transcript and a stored file read identically.
 *
 * Program output is never re-wrapped: a wrapped log line, command or JSON body
 * lies about its shape, so the block keeps `whitespace-pre` and scrolls
 * HORIZONTALLY on its own, the one scroll a detail pane sanctions, because the
 * pane cannot carry it.
 *
 * VERTICALLY it never scrolls: the pane is the only scroll context for height.
 * Long data is CLAMPED to a head and grown inline ({@link GuardLongText}), so the
 * page grows and the block never gets its own vertical scrollbar.
 */
export const PRE = ARTIFACT_PRE;
