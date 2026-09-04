/**
 * OUTPUT MARKERS — "has the program written this line yet?", asked of a stream that
 * arrives in chunks.
 *
 * Two step features ask it and must answer it identically: a PROMPT-KEYED terminal
 * answer, which is typed the moment its question appears (`pty.ts`), and a HELD
 * command's `until`, which ends the step the moment its ready line appears
 * (`executor.ts`). One module, so a marker means the same thing whichever asks.
 *
 * What a marker is matched against is what the PROGRAM WROTE, with the terminal's
 * own doing removed: ANSI escapes stripped and `\r\n` folded to `\n` — the same text
 * an `expect.output` matcher sees. So a marker is the words in the source, never the
 * decoration a prompt library or a spinner wrapped them in.
 *
 * Chunk boundaries are the only subtlety, and {@link heldBack} is the whole of it: a
 * chunk can end mid-escape-sequence or on the `\r` half of a `\r\n`, and those bytes
 * must wait for the next chunk rather than be transformed as if complete.
 */

/**
 * Every escape sequence a terminal program writes to POSITION, COLOR or ERASE —
 * CSI (`ESC [ … final`), OSC (`ESC ] …` up to its BEL/ST terminator) and the
 * two-byte Fe escapes. Stripped before a marker is looked for, so a marker matches
 * the words the program wrote rather than the decoration around them (a spinner
 * redrawing its line, a bold question, a hidden cursor).
 */
const ANSI_SEQUENCE =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** What a program WROTE, with the terminal's own doing removed. */
export function markerText(chunk: string): string {
  return chunk.replace(ANSI_SEQUENCE, '').replaceAll('\r\n', '\n')
}

/**
 * A tail that may still GROW into something {@link markerText} would transform: a
 * lone `\r` (half of a `\r\n`) or an escape sequence that has not terminated yet.
 * Anchored at both ends, so a COMPLETE sequence followed by text is never held —
 * held bytes wait for the next chunk, and a child that has just drawn its prompt
 * writes nothing more until it is answered.
 */
const PARTIAL_ESCAPE = /^\u001b(?:\[[0-9;?]*[ -/]*|\][^\u0007\u001b]*|)$/

/** How many trailing characters of `text` must wait for the next chunk. */
export function heldBack(text: string): number {
  if (text.endsWith('\r')) return 1
  const esc = text.lastIndexOf('\u001b')
  if (esc >= 0 && PARTIAL_ESCAPE.test(text.slice(esc))) return text.length - esc
  return 0
}

/**
 * A running view of what a child has written, in marker terms — fed chunk by chunk,
 * searched from a cursor that only moves forward.
 *
 * The cursor is what makes a SEQUENCE of markers mean what it says: each is looked
 * for after the previous one's match, so two questions worded alike are still two
 * questions. It is also what keeps the search linear over a long-running command's
 * output instead of re-scanning everything on every chunk.
 */
export interface MarkerWatch {
  /** Feed one chunk of the child's output. */
  feed(chunk: string): void
  /**
   * True once `marker` has appeared at or after the cursor. Moves the cursor past
   * the match, so the next question starts looking after this one's answer.
   */
  seen(marker: string): boolean
  /** Drop the buffer — nothing is looking for anything more. */
  done(): void
}

export function markerWatch(): MarkerWatch {
  /** Everything the child has written, as {@link markerText} sees it. */
  let view = ''
  /** Tail bytes that may still grow — see {@link heldBack}. */
  let carry = ''
  /** Where the next marker search starts: past the marker last matched. */
  let cursor = 0
  let finished = false
  return {
    feed(chunk: string): void {
      if (finished) return
      const buf = carry + chunk
      const held = heldBack(buf)
      carry = held ? buf.slice(buf.length - held) : ''
      view += markerText(held ? buf.slice(0, buf.length - held) : buf)
    },
    seen(marker: string): boolean {
      if (finished) return false
      const at = view.indexOf(marker, cursor)
      if (at < 0) return false
      cursor = at + marker.length
      return true
    },
    done(): void {
      finished = true
      view = ''
      carry = ''
    },
  }
}
