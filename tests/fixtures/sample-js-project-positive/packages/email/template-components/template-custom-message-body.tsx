
// Multiple newline collapse — /\n{2,}/ is ASCII control chars only, unicode flag unnecessary.
export function normalizeMessageBody(text: string): string {
  return text
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/\n\s*\n+/g, '\n\n')
    .replace(/\n{2,}/g, '\n\n');
}



// Blank line normalization /\n\s*\n+/ — ASCII whitespace, unicode flag unnecessary.
export function collapseBlankLines(text: string): string {
  return text
    .trim()
    .replace(/\r\n?/g, '\n')
    .replace(/\n\s*\n+/g, '\n\n');
}
