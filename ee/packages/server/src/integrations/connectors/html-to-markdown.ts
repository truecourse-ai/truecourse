/**
 * Convert Confluence "storage format" (XHTML) to markdown-ish text.
 *
 * Dependency-free and DETERMINISTIC — the same XHTML must always yield
 * byte-identical markdown, because the consolidator content-addresses each block
 * by `sha256(docPath + headingPath + text)`. Any nondeterminism (or a converter
 * that flattened headings) would change block ids → cache misses → LLM cost on
 * every sync, even for unchanged pages. So: **headings are preserved** as
 * `#..######` (the consolidator slices blocks by heading), lists/paragraphs
 * become readable text, and Confluence macro wrappers are dropped to their text.
 *
 * Tags are stripped BEFORE entities are decoded, and entities are decoded ONCE
 * at the very end — otherwise a decoded `&lt;tag&gt;` would be re-eaten by the
 * tag stripper.
 */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // last, so we don't double-decode (e.g. &amp;lt;)
}

/** Resolve inline markup, then strip any remaining tags. Entities are left as-is. */
function inlineMarkup(s: string): string {
  return s
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$2`')
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function storageXhtmlToMarkdown(xhtml: string): string {
  let s = xhtml;

  // Confluence macros (`<ac:…>`, `<ri:…>`) — drop the wrapper tags, keep inner text.
  s = s.replace(/<\/?(ac|ri):[^>]*>/gi, '');

  // Code/preformatted blocks first (preserve their raw text, tags removed).
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    return `\n\n\`\`\`\n${inner.replace(/<[^>]+>/g, '').trim()}\n\`\`\`\n\n`;
  });

  // Headings — the load-bearing structure for block slicing.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, inner: string) => {
    return `\n\n${'#'.repeat(Number(n))} ${inlineMarkup(inner)}\n\n`;
  });

  // List items → "- "; list wrappers → blank lines (nesting is flattened — fine).
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `- ${inlineMarkup(inner)}\n`);
  s = s.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

  // Paragraphs + line breaks.
  s = s.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, inner: string) => `\n${inlineMarkup(inner)}\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Anything left (tables, divs, stray tags + inline markup) → strip.
  s = inlineMarkup(s);

  // Decode entities ONCE, after all tag-stripping. Then normalize whitespace.
  return decodeEntities(s)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
