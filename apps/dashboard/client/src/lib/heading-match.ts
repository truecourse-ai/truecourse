/**
 * Canonical key for matching a heading against a section pointer. Pointers and
 * split-section headings carry RAW markdown (`` `rm <id>` `` keeps its backticks)
 * while rendered DOM textContent does not — so every comparison must strip
 * inline-code markers or raw-vs-rendered pairs silently miss (seen live: a
 * conflict column banding but not scrolling). Backticks only: emphasis
 * characters are usually literal in technical headings (`_inferred`).
 */
export const headingMatchKey = (s: string): string => s.replace(/`/g, '').trim().toLowerCase();
