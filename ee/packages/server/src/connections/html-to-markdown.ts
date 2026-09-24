/**
 * Convert Confluence "storage format" (XHTML) to markdown-ish text.
 *
 * Dependency-free and DETERMINISTIC — the same XHTML must always yield
 * byte-identical markdown, because the consolidator content-addresses each block
 * by `sha256(docPath + headingPath + text)`. Any nondeterminism (or a converter
 * that flattened headings) would change block ids → cache misses → LLM cost on
 * every sync, even for unchanged pages. So: **headings are preserved** as
 * `#..######` (the consolidator slices blocks by heading), lists/paragraphs
 * become readable text, a code macro becomes a fenced block, and every other
 * Confluence macro wrapper is dropped to its text — its PARAMETERS dropped
 * whole, because a macro's configuration is not the page's content.
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
    // `$1`, not `$2`: the bold and italic rules above capture their own tag
    // name first, this one does not. A wrong index is not an error in
    // `String.replace` — it emits the token, so every inline code span became
    // the literal `$2` and the value it held was lost.
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** The text of a CDATA section, or the string unchanged when it is not one. */
function uncdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/**
 * Leading whitespace, on every line that is not inside a fence.
 *
 * Storage format is pretty-printed, and stripping a tag leaves its indentation
 * behind. Four spaces is an indented code block in markdown, so a nested list
 * came out as a wall of grey — the words were still there and no reader could
 * tell they were prose. A fence keeps its own indentation, which is the code's.
 */
function dedentOutsideFences(s: string): string {
  let inFence = false;
  return s
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line.trimStart();
      }
      return inFence ? line : line.trimStart();
    })
    .join('\n');
}

export function storageXhtmlToMarkdown(xhtml: string): string {
  let s = xhtml;

  // A CODE MACRO is a fenced block: its language is a parameter and its body is
  // CDATA. Taken before the generic macro strip below, which would leave the
  // language word sitting in the prose and the body indistinguishable from it.
  s = s.replace(
    /<ac:structured-macro\b[^>]*ac:name="code"[\s\S]*?<\/ac:structured-macro>/gi,
    (macro: string) => {
      const language =
        /<ac:parameter\b[^>]*ac:name="language"[^>]*>([\s\S]*?)<\/ac:parameter>/i
          .exec(macro)?.[1]
          ?.trim() ?? '';
      const body =
        /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i.exec(macro)?.[1] ?? '';
      return `\n\n\`\`\`${language}\n${uncdata(body).trim()}\n\`\`\`\n\n`;
    },
  );

  // A macro PARAMETER is configuration, never content — a panel's colour, a
  // macro's language, a layout's width. Dropped whole: keeping the text inside
  // it is what put bare words like `json` and `note` in the middle of a page.
  s = s.replace(/<ac:parameter\b[\s\S]*?<\/ac:parameter>/gi, '');
  s = s.replace(/<ac:parameter\b[^>]*\/>/gi, '');

  // Confluence macros (`<ac:…>`, `<ri:…>`) — drop the wrapper tags, keep inner text.
  s = s.replace(/<\/?(ac|ri):[^>]*>/gi, '');
  s = uncdata(s);

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
  return dedentOutsideFences(decodeEntities(s))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
