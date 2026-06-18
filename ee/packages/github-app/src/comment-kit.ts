/**
 * Shared helpers for the App's interactive checkbox comments (spec scan, infer).
 * Each flow is identified by a hidden marker and driven by a single task-list
 * checkbox; this factory yields the marker/checkbox predicates so both flows
 * share one implementation.
 */

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CommentKit {
  marker: string;
  checkboxLabel: string;
  /** Our comment? (carries the hidden marker) */
  isOurs(body: string | undefined | null): boolean;
  /** Checkbox ticked (`- [x] <label>`)? */
  isChecked(body: string | undefined | null): boolean;
  /** Still an actionable offer (`- [ ] <label>`)? */
  hasOffer(body: string | undefined | null): boolean;
  /** The unchecked checkbox line to embed in a comment body. */
  checkboxLine(): string;
}

export function makeCommentKit(
  marker: string,
  checkboxLabel: string,
): CommentKit {
  const checked = new RegExp(
    `^[-*]\\s*\\[x\\]\\s*${escapeRegExp(checkboxLabel)}`,
    'im',
  );
  const offer = new RegExp(
    `^[-*]\\s*\\[ \\]\\s*${escapeRegExp(checkboxLabel)}`,
    'im',
  );
  return {
    marker,
    checkboxLabel,
    isOurs: (b) => !!b && b.includes(marker),
    isChecked: (b) => !!b && checked.test(b),
    hasOffer: (b) => !!b && offer.test(b),
    checkboxLine: () => `- [ ] ${checkboxLabel}`,
  };
}
