/**
 * Deterministic section reading over a doc's markdown — what the scan's
 * `read_section` tool answers with and what a briefing shows a doc as. Built
 * on the shared doc-chunks heading scan (`parseHeadings`), the one fence-aware
 * ATX scanner every doc consumer shares:
 *
 * - {@link headingOutline} — the doc's headings, one per line, hash-prefixed.
 *   A conflicts-session briefing shows each doc as its outline, never its full
 *   body.
 * - {@link leadText} / {@link sectionText} — the lead for a `null` pointer, a
 *   heading's section down to the next same-or-higher heading otherwise.
 */

import { parseHeadings } from '@truecourse/shared';

/** Match key for a heading pointer vs a section heading — strip inline-code +
 *  emphasis markers, fold case. */
const headingKey = (h: string): string => h.replace(/[`*_~]/g, '').trim().toLowerCase();

/** The doc's headings, one per line, prefixed with their level's hashes. */
export function headingOutline(body: string): string {
  const headings = parseHeadings(body.split('\n'));
  if (headings.length === 0) return '(no headings)';
  return headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

/** The doc's lead: everything before its first heading (the whole body if none). */
export function leadText(body: string): string {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const end = headings.length ? headings[0].line : lines.length;
  return lines.slice(0, end).join('\n');
}

/**
 * The full text of the section whose heading matches `heading` — the heading line
 * down to the next heading of the same or higher level (its subsections included),
 * or `null` when no heading matches. Heading match folds inline markers + case, so
 * a backtick-styled or emphasized heading still resolves.
 */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const key = headingKey(heading);
  const idx = headings.findIndex((h) => headingKey(h.text) === key);
  if (idx === -1) return null;
  const level = headings[idx].level;
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      end = headings[j].line;
      break;
    }
  }
  return lines.slice(headings[idx].line, end).join('\n');
}
