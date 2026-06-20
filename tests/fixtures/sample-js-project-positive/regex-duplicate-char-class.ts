// A character class whose only member is a single Unicode property escape
// (`\p{ASCII}`). The repeated letters inside the property name (`ASCII` has
// two `I`s) belong to one atomic `\p{…}` token — they are not separate
// character-class members, so there is no duplicate to flag.

const printableOnly = /^[\p{ASCII}]*$/u;

// A second class mixing two distinct Unicode property escapes — still no
// duplicate members once each `\p{…}` is treated as one token.
const wordLike = /[\p{Letter}\p{Number}]+/u;

export function isPrintable(value: string): boolean {
  return printableOnly.test(value);
}

export function looksLikeWord(value: string): boolean {
  return wordLike.test(value);
}
