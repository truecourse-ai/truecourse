/**
 * The blocks the guard coverage surface paints: one per section of the shared
 * document tree, each the section's OWN text (its heading and the body before
 * its first subsection), so rendering them in order reproduces the whole
 * document once. A block carries the anchor the server's coverage sections are
 * keyed by, built by the same tree from the same source, so the two meet on
 * the anchor and a `#` line in a code fence can never shift a status.
 *
 * The rest is the in-page link plumbing: the empty `<a id>` anchors reference
 * docs mint, stripped from the paint and mapped to the section a click on them
 * should select.
 */

import { sectionOwnText, slugifyHeading, type DocTree } from '@truecourse/shared';

export interface DocBlock {
  /** The section's anchor, the coverage's key. */
  anchor: string;
  /** Heading level 1–6; 0 for the lead. */
  level: number;
  /** Raw heading text ('' for the lead). */
  headingText: string;
  /** Heading line + its body up to the next heading (any level). */
  text: string;
}

/** The tree's sections as flat blocks, in document order. */
export function docBlocks(tree: DocTree): DocBlock[] {
  return tree.sections.map((s) => ({
    anchor: s.anchor,
    level: s.level,
    headingText: s.level === 0 ? '' : s.headingText,
    text: sectionOwnText(tree, s),
  }));
}

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
 * as visible text. Purely cosmetic: blocks partition by section, so removing an
 * anchor from a block's rendered text never shifts a boundary.
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
 * it should scroll to, so the coverage view turns an in-doc cross-reference
 * (`[§1](#introduction)`) into a `?section` selection instead of a new tab.
 *
 * Targets: each covered block's heading slug and its anchor, plus the doc's
 * empty `<a id>` anchors. Ownership follows the doc's convention that an anchor
 * sits just ABOVE the heading it names: a standalone anchor in a block's
 * trailing region (only blanks/anchors after it, i.e. right before the next
 * heading) binds to the NEXT section; an inline-in-heading or mid-body anchor
 * binds to its own section. First writer wins, so an earlier heading's slug is
 * never overwritten. `covered` holds the anchors the server's coverage knows.
 */
export function buildAnchorTargets(blocks: readonly DocBlock[], covered: ReadonlyMap<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const put = (id: string | undefined, anchor: string | undefined): void => {
    if (id && anchor && !map.has(id)) map.set(id, anchor);
  };
  const coveredAnchor = (block: DocBlock | undefined): string | undefined =>
    block && covered.has(block.anchor) ? block.anchor : undefined;

  blocks.forEach((block, i) => {
    const own = coveredAnchor(block);
    const next = coveredAnchor(blocks[i + 1]);
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
