// `\|` is an escaped literal pipe, not an alternation operator. A pattern that
// merely has an escaped pipe at its start or end therefore has no empty
// alternative — the rule must inspect structural `|` operators, not the raw
// pipe bytes that happen to sit at the pattern boundary.

export const escapedPipe = /\|/;

export const trailingEscapedPipe = /value\|/;
