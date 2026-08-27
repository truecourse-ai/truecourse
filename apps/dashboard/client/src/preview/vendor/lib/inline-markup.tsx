/**
 * The ONE inline-markup reading the dashboard does, for prose an LLM authored:
 * violation text, fix prompts, and the authoring `note` on a guard step all
 * arrive with backticked identifiers and the occasional **emphasis**, because
 * that is how a model writes prose about code.
 *
 * Exactly two marks are rendered, inline code and bold, and everything else
 * (headings, lists, links, images) stays literal. These strings are SENTENCES,
 * not documents: a note that could grow a heading would be a second document
 * viewer inside a step row, and the spec docs already have one
 * ({@link DocMarkdown}).
 *
 * Unbalanced markers stay as typed: a lone backtick is a backtick, never the
 * start of a span that swallows the rest of the sentence.
 */

import { Fragment, type ReactNode } from 'react';

/** Backticked spans → `<code>`, `**bold**` → `<strong>`, the rest verbatim. */
export function renderInlineMarkup(text: string | null | undefined): ReactNode {
  if (!text) return null;
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length >= 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
