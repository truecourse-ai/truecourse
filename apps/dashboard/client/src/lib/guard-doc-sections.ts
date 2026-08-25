/**
 * Split a spec doc's markdown into heading-delimited blocks for the guard
 * coverage surface, then align those blocks with the server's coverage sections.
 *
 * The server ships per-section coverage (anchor/status/scenarios) but not the
 * doc body, so the client re-reads the raw markdown (the same file, via the Spec
 * doc endpoint) and paints each heading's slice. For the paint to line up, the
 * client's heading detection must match the server's section index exactly —
 * ATX headings only, skipping any inside fenced code blocks (a `#` line in a
 * shell example is not a heading). This mirrors `parseHeadings` in
 * packages/guard-runner/src/section-index.ts; keep the two rules identical.
 *
 * Blocks are a FLAT partition (each heading + its body up to the NEXT heading of
 * any level) so rendering them in order reproduces the whole document once —
 * unlike the server's nested `fullText`. The heading count and order still match
 * the server's sections 1:1, so alignment is by document order (with a
 * heading-text guard so a spurious block just renders unmarked instead of
 * shifting every later status).
 */

import type { GuardSectionCoverage } from '@truecourse/shared';

export interface DocBlock {
  /** Heading level 1–6; 0 for the pre-heading preamble. */
  level: number;
  /** Raw heading text ('' for the preamble). */
  headingText: string;
  /** Heading line + its body up to the next heading (any level). */
  text: string;
}

// ATX heading: up to 3 leading spaces, 1–6 `#`, optional space+text with an
// optional trailing `#` run. A bare `#foo` (no space) is not a heading.
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
// Fenced code delimiter: up to 3 leading spaces, then ≥3 backticks or tildes.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Flat heading-delimited blocks, fence-aware. The first entry is the preamble
 * (level 0) only when the doc has content before its first heading.
 */
export function splitDocBlocks(content: string): DocBlock[] {
  const lines = content.split('\n');
  const blocks: DocBlock[] = [];
  let cur: DocBlock | null = null;
  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;

  const flush = () => {
    if (cur && (cur.headingText !== '' || cur.text.trim() !== '')) blocks.push(cur);
  };

  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fenceChar) {
      // Only a same-or-longer run of the opening char (nothing after) closes it.
      if (fence && fence[1][0] === fenceChar && fence[1].length >= fenceLen && fence[2].trim() === '') {
        fenceChar = null;
        fenceLen = 0;
      }
      if (cur) cur.text += `${line}\n`;
      else cur = { level: 0, headingText: '', text: `${line}\n` };
      continue;
    }
    if (fence) {
      fenceChar = fence[1][0] as '`' | '~';
      fenceLen = fence[1].length;
      if (cur) cur.text += `${line}\n`;
      else cur = { level: 0, headingText: '', text: `${line}\n` };
      continue;
    }

    const m = ATX_HEADING.exec(line);
    const headingText = m ? (m[2] ?? '').trim() : '';
    if (m && headingText) {
      flush();
      cur = { level: m[1].length, headingText, text: `${line}\n` };
    } else if (cur) {
      cur.text += `${line}\n`;
    } else {
      cur = { level: 0, headingText: '', text: `${line}\n` };
    }
  }
  flush();
  return blocks;
}

import { headingMatchKey as norm } from './heading-match';

// Slugify a heading the GitHub/anchor way — strip inline emphasis/code markers,
// lowercase, fold non-alphanumeric runs to single hyphens, trim. Mirrors
// `slugifyHeading` in packages/guard-runner/src/section-index.ts; used only to
// resolve in-doc `#heading-slug` links, never to move a boundary.
const slugifyHeading = (text: string): string =>
  text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// An empty in-page anchor element: `<a id="…"></a>` / `<a name="…"></a>` with no
// inner text. The reference doc scatters these before/inside headings to mint
// stable link targets. react-markdown (no rehype-raw) prints raw HTML as literal
// text, so the coverage renderer strips them before painting. A real link
// (`<a href>text</a>`) has inner text and is left untouched.
const EMPTY_ANCHOR = /<a\b[^>]*>\s*<\/a>/gi;
// The id/name an empty anchor mints, for link-target resolution.
const ANCHOR_ID = /<a\b[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>\s*<\/a>/gi;

/**
 * Drop empty `<a id>`/`<a name>` anchor tags so react-markdown never renders them
 * as visible text. Purely cosmetic: blocks partition by heading text/level, so
 * removing an anchor from a block's rendered text never shifts a boundary or the
 * section alignment.
 */
export function stripDocAnchors(text: string): string {
  return text.replace(EMPTY_ANCHOR, '');
}

const idsIn = (line: string): string[] => {
  const ids: string[] = [];
  ANCHOR_ID.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANCHOR_ID.exec(line))) ids.push(m[1].toLowerCase());
  return ids;
};

const isBlankOrAnchorOnly = (line: string): boolean => stripDocAnchors(line).trim() === '';

/**
 * Map every in-page link target the doc mints to the coverage section a click on
 * it should scroll to — so the coverage view turns an in-doc cross-reference
 * (`[§1](#introduction)`) into a `?gsec` selection instead of a new tab.
 *
 * Targets: each block's heading slug and its server anchor, plus the doc's empty
 * `<a id>` anchors. Ownership follows the doc's convention that an anchor sits
 * just ABOVE the heading it names: a standalone anchor in a block's trailing
 * region (only blanks/anchors after it, i.e. right before the next heading) binds
 * to the NEXT section; an inline-in-heading or mid-body anchor binds to its own
 * section. First writer wins, so an earlier heading's slug is never overwritten.
 */
export function buildAnchorTargets(
  blocks: readonly DocBlock[],
  aligned: ReadonlyArray<GuardSectionCoverage | null>,
): Map<string, string> {
  const map = new Map<string, string>();
  const put = (id: string | undefined, anchor: string | undefined): void => {
    if (id && anchor && !map.has(id)) map.set(id, anchor);
  };

  blocks.forEach((block, i) => {
    const own = aligned[i]?.anchor;
    const next = aligned[i + 1]?.anchor;
    if (own) {
      put(own, own);
      put(slugifyHeading(block.headingText), own);
    }
    const lines = block.text.split('\n');
    lines.forEach((line, li) => {
      const ids = idsIn(line);
      if (ids.length === 0) return;
      const inHeading = li === 0 && block.level > 0;
      // Trailing = every later line in this block is blank or anchor-only, so the
      // anchor sits immediately before the next heading → it names that section.
      const trailing = !inHeading && lines.slice(li + 1).every(isBlankOrAnchorOnly);
      const target = inHeading ? own : trailing ? next ?? own : own;
      for (const id of ids) put(id, target);
    });
  });
  return map;
}

/**
 * Coverage section aligned to each rendered block, parallel to `blocks`. A block
 * whose heading doesn't match the next unconsumed section gets `null` (rendered
 * without a status band). With the fence-aware split above this consumes the
 * sections in lockstep; the guard only matters if the two heading rules ever
 * diverge, and then it fails safe (unmarked) rather than mis-colouring.
 *
 * The preamble block is the doc's LEAD REGION, which the server derives as a
 * section of its own (level 0, named by the frontmatter title). It has no heading
 * for the text guard to compare, so it aligns structurally: the leading preamble
 * takes a leading level-0 section, and both are first by construction. Consuming
 * it is what keeps the rest in lockstep — leaving it unconsumed would push every
 * heading block against the lead and unmark the whole document.
 */
export function alignSections(
  blocks: DocBlock[],
  sections: readonly GuardSectionCoverage[],
): Array<GuardSectionCoverage | null> {
  const out: Array<GuardSectionCoverage | null> = [];
  let si = 0;
  for (const [i, block] of blocks.entries()) {
    if (block.level === 0 || block.headingText === '') {
      const lead = i === 0 && si === 0 && sections[0]?.level === 0 ? sections[0] : null;
      if (lead) si++;
      out.push(lead);
      continue;
    }
    const next = sections[si];
    if (next && next.level === block.level && norm(next.headingText) === norm(block.headingText)) {
      out.push(next);
      si++;
    } else {
      out.push(null);
    }
  }
  return out;
}
