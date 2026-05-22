// FP shapes for `regex-anchor-precedence`: (1) each alternative is anchored
// independently (so the anchor is correctly applied to every branch) and
// (2) the `|` characters live inside a character class, where they are
// literals, not alternation.

// Shape 1: top-level alternation where every alternative carries its own
// start anchor. The intent is fully expressed — no precedence ambiguity.
export const blocklistedPathsRegex = /^\/api\/|^\/__/u;

// Shape 2: an email-style regex with `|` literal inside a character class.
// The rule must not interpret class-internal `|` as alternation.
export const emailLooseRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/u;

// Shape 3: every alternative is end-anchored consistently — symmetric to
// Shape 1 but on the trailing side.
export const trailingAnchorRegex = /foo$|bar$/u;
