import { Fragment } from 'react';

/**
 * Render text that uses markdown-style backticks around code identifiers —
 * the convention used by deterministic rules, LLM prompts, and
 * LLM-generated service descriptions. Backtick-wrapped spans become
 * inline `<code>` elements; everything else stays as plain text.
 *
 * Intentionally does NOT support other markdown (bold, links, lists) —
 * the text this handles is always short (one sentence or a few), and
 * pulling in a full markdown parser would be overkill. If a caller ever
 * needs richer rendering, switch that call site to `ReactMarkdown`.
 */
export function renderInlineCode(text: string | null | undefined): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
