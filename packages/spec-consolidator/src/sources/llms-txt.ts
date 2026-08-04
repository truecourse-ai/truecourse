/**
 * llms.txt parsing — the markdown index an llms.txt-enabled docs site publishes:
 * an H1 title, an optional blockquote summary, then H2 sections whose list items
 * are `- [title](url): description` links.
 *
 * Every section is kept, "Optional" included: the corpus never silently thins
 * what the model gets to see. Relevance is decided later, by the scan, with the
 * user able to override it.
 *
 * Only LIST-ITEM links are collected. Inline links inside prose (or inside the
 * summary blockquote) are navigation, not doc entries, and pulling them in would
 * snapshot pages the site never listed.
 */

/** One `- [title](url): description` entry. */
export interface LlmsTxtLink {
  title: string;
  /** Absolute and normalized — see {@link normalizeSourceUrl}. */
  url: string;
  description?: string;
}

/** One `## Name` block. `name` is `''` for links that precede any H2. */
export interface LlmsTxtSection {
  name: string;
  links: LlmsTxtLink[];
}

export interface LlmsTxtDoc {
  /** The H1 text, or `''` when the file has none. */
  title: string;
  /** The blockquote under the H1, when present. */
  summary?: string;
  sections: LlmsTxtSection[];
}

const FENCE = /^\s*(?:```|~~~)/;
const H1 = /^#\s+(.*)$/;
const H2 = /^##\s+(.*)$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const LIST_LINK = /^\s*[-*+]\s+\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\s*(?::\s*(.*))?$/;

/**
 * Canonical form of a page URL: absolute, http(s) only, no fragment, no query,
 * no trailing slash (except the origin root). This is the identity used for
 * dedupe, for the refresh diff, and for the snapshot path mapping — so the same
 * page written three different ways in an llms.txt is fetched once.
 *
 * Returns null for anything that isn't a fetchable page (`mailto:`, malformed).
 */
export function normalizeSourceUrl(raw: string, baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.search = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/**
 * Parse an llms.txt document. `baseUrl` is the llms.txt's own URL — relative
 * links resolve against it. Links are deduped document-wide by normalized URL,
 * first occurrence wins (so a page listed in both a main section and "Optional"
 * keeps its richer first description).
 */
export function parseLlmsTxt(text: string, baseUrl: string): LlmsTxtDoc {
  const sections: LlmsTxtSection[] = [];
  const seen = new Set<string>();
  let title = '';
  let summary: string | undefined;
  let current: LlmsTxtSection | null = null;
  let inFence = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h1 = H1.exec(line);
    if (h1) {
      if (!title) title = h1[1].trim();
      continue;
    }

    const h2 = H2.exec(line);
    if (h2) {
      current = { name: h2[1].trim(), links: [] };
      sections.push(current);
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote && sections.length === 0) {
      const part = quote[1].trim();
      if (part) summary = summary ? `${summary} ${part}` : part;
      continue;
    }

    const link = LIST_LINK.exec(line);
    if (!link) continue;
    const url = normalizeSourceUrl(link[2], baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (!current) {
      current = { name: '', links: [] };
      sections.push(current);
    }
    const description = link[3]?.trim();
    current.links.push({
      title: link[1].trim(),
      url,
      ...(description ? { description } : {}),
    });
  }

  return { title, ...(summary ? { summary } : {}), sections };
}

/** Every link in document order — the order snapshot paths are assigned in. */
export function flattenLinks(doc: LlmsTxtDoc): LlmsTxtLink[] {
  return doc.sections.flatMap((section) => section.links);
}
