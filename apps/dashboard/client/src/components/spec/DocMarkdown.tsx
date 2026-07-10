/**
 * DocMarkdown — renders a full markdown document with element-level styling
 * (headings, lists, code, tables, blockquotes). The dashboard doesn't ship the
 * Tailwind typography plugin, so `prose` is a no-op — we style each element via
 * ReactMarkdown `components`, the same approach the claims viewer uses, scaled up
 * here for a full-page doc rather than a compact preview.
 *
 * `highlight` marks the conflicting sections in place: the WHOLE section (its
 * heading + body up to the next heading) gets an amber band, so the user sees
 * exactly where two docs disagree, right on the document. `highlightPreamble`
 * bands the doc's LEAD — the disputed opening passage — the same way: content
 * before the first heading when the doc has such a preamble (a badge/tagline
 * block), else the opening heading's own section (the H1 line + its body up to
 * the next heading) for the common README shape that starts with an H1 title.
 * The heading line stays inside the band since it's part of the disputed lead.
 */

import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import { headingMatchKey as norm } from '@/lib/heading-match';

// Extend GitHub's sanitize schema so README-style raw HTML renders instead of
// leaking as source: images (logos/badges), alignment wrappers, and invisible
// `<a id>`/heading anchors. Everything else stays on the default allowlist and
// `<script>` is still stripped.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'width', 'height'],
    a: [...(defaultSchema.attributes?.a ?? []), 'id'],
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 ?? []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 ?? []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 ?? []), 'id'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align'],
    div: [...(defaultSchema.attributes?.div ?? []), 'align'],
    td: [...(defaultSchema.attributes?.td ?? []), 'align'],
    th: [...(defaultSchema.attributes?.th ?? []), 'align'],
  },
};

const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-5 border-b border-border pb-1 text-xl font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  // Relative size so a code span inside a heading scales with the heading
  // instead of shrinking to body-code size (command-signature headings are
  // common in real docs).
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">{children}</code>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-auto rounded border border-border bg-muted/50 p-3 font-mono text-[12px] text-foreground">{children}</pre>
  ),
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href, id }) => (
    <a href={href} id={id} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{children}</a>
  ),
  img: ({ node, ...props }) => <img {...props} className="inline-block max-w-full" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 italic text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border bg-muted/40">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/40 last:border-0">{children}</tr>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
};

function Md({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
      components={COMPONENTS}
    >
      {source}
    </ReactMarkdown>
  );
}

interface Section {
  heading: string;
  text: string;
}

/** Split markdown into sections, each = a heading line + its body up to the next heading. */
function splitSections(source: string): Section[] {
  const headingRe = /^#{1,6}\s+(.*)$/;
  const sections: Section[] = [];
  let cur: Section = { heading: '', text: '' };
  for (const line of source.split('\n')) {
    const m = headingRe.exec(line);
    if (m) {
      if (cur.text.trim() || cur.heading) sections.push(cur);
      cur = { heading: m[1].trim(), text: `${line}\n` };
    } else {
      cur.text += `${line}\n`;
    }
  }
  if (cur.text.trim() || cur.heading) sections.push(cur);
  return sections;
}

export function DocMarkdown({
  source,
  highlight = [],
  highlightPreamble = false,
}: {
  source: string;
  highlight?: string[];
  /** Band the doc's lead (content before the first heading, else the opening
   *  heading's own section) — for null-heading preamble conflicts. */
  highlightPreamble?: boolean;
}): ReactNode {
  const hl = new Set(highlight.map(norm));

  if (hl.size === 0 && !highlightPreamble) {
    return (
      <div className="text-[13px] leading-relaxed text-foreground">
        <Md source={source} />
      </div>
    );
  }

  // Render section-by-section so a whole conflicting section can be banded.
  return (
    <div className="text-[13px] leading-relaxed text-foreground">
      {splitSections(source).map((sec, i) => {
        // The preamble band = the doc's LEAD (section 0): the true preamble when
        // the doc has content before its first heading, else the opening heading's
        // own section (the common README shape that starts with an H1). Heading
        // pointers band their matching section as usual.
        const headingMatch = sec.heading !== '' && hl.has(norm(sec.heading));
        const on = headingMatch || (i === 0 && highlightPreamble);
        return (
          <div
            key={i}
            className={on ? '-mx-2 my-1 scroll-mt-2 rounded border-l-4 border-amber-500 bg-amber-500/10 px-2 py-1' : undefined}
          >
            <Md source={sec.text} />
          </div>
        );
      })}
    </div>
  );
}
