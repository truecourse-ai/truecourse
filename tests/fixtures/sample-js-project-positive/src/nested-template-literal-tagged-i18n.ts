/**
 * Nested template literals inside a tagged-template i18n message are
 * library convention: the i18n tag (`t`, `msg`, `jt`, `plural`, ...)
 * collects the static parts and substitutions into a translatable
 * message ID, so callers commonly wrap an interpolated value in quotes
 * or punctuation by nesting a plain template literal inside.
 * The nested literal here is for formatting, not deep composition.
 */

declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

export function buildSigningSubject(title: string, actorVerb: string): string {
  return t`You have initiated the document ${`"${title}"`} that requires you to ${actorVerb} it.`;
}

export function buildSigningHeader(title: string): string {
  return msg`The document ${`"${title}"`} is ready for review.`;
}
