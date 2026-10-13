/**
 * DocMarkdown — renders a full markdown document with element-level styling
 * (headings, lists, code, tables, blockquotes). The dashboard doesn't ship the
 * Tailwind typography plugin, so `prose` is a no-op — we style each element via
 * ReactMarkdown `components`, the same approach the claims viewer uses, scaled up
 * here for a full-page doc rather than a compact preview.
 *
 * Container directives (`:::note … :::`) are markdown too here: fetched pages
 * from Docusaurus-based sites are full of them, so they render as callouts —
 * known type or not — rather than leaking their `:::` fences as prose.
 *
 * A leading YAML frontmatter block is metadata a doc states ABOUT itself — a
 * synced ticket's dates and status, a PRD's own header — and `remark-frontmatter`
 * parses it into a node this renderer has no handler for, so it never reaches
 * the page. Hiding it is presentation only: the block stays in the source every
 * consumer downstream reads, and {@link DocFacts} states it as facts instead.
 *
 * `marks` are the sentences a conflict points at, by their character ranges in
 * the source: each is marked in place, so the reader sees the very sentence
 * two docs disagree on, not the section around it.
 */

import { useMemo, type ComponentType, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';

import { ADMONITION_KIND, ADMONITION_TITLE, remarkAdmonitions } from '@/lib/remark-admonitions';
import { SENTENCE_MARK, remarkSentenceMarks, type SentenceRange } from '@/lib/remark-sentence-marks';

// Extend GitHub's sanitize schema so README-style raw HTML renders instead of
// leaking as source: images (logos/badges), alignment wrappers, and invisible
// `<a id>`/heading anchors, plus the two data attributes the admonition
// transform puts on its container and the sentence mark (`<mark>` and the key
// it carries). Everything else stays on the default allowlist and `<script>`
// is still stripped.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), SENTENCE_MARK],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'width', 'height'],
    a: [...(defaultSchema.attributes?.a ?? []), 'id'],
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 ?? []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 ?? []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 ?? []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 ?? []), 'id'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align'],
    div: [...(defaultSchema.attributes?.div ?? []), 'align', ADMONITION_KIND, ADMONITION_TITLE],
    td: [...(defaultSchema.attributes?.td ?? []), 'align'],
    th: [...(defaultSchema.attributes?.th ?? []), 'align'],
  },
};

/**
 * The admonition kinds docs sites actually write. Anything else (`prerequisites`,
 * a site's own invention) still renders as a callout — generic tone, its own name
 * as the label — because the one thing it must never do is leak `:::` lines.
 */
const ADMONITIONS: Record<
  string,
  { label: string; icon: ComponentType<{ className?: string }>; band: string; head: string }
> = {
  note: { label: 'Note', icon: Info, band: 'border-sky-500 bg-sky-500/5', head: 'text-sky-700 dark:text-sky-300' },
  info: { label: 'Info', icon: Info, band: 'border-sky-500 bg-sky-500/5', head: 'text-sky-700 dark:text-sky-300' },
  tip: {
    label: 'Tip',
    icon: Lightbulb,
    band: 'border-emerald-500 bg-emerald-500/5',
    head: 'text-emerald-700 dark:text-emerald-300',
  },
  caution: {
    label: 'Caution',
    icon: TriangleAlert,
    band: 'border-amber-500 bg-amber-500/5',
    head: 'text-amber-700 dark:text-amber-300',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    band: 'border-amber-500 bg-amber-500/5',
    head: 'text-amber-700 dark:text-amber-300',
  },
  danger: {
    label: 'Danger',
    icon: OctagonAlert,
    band: 'border-red-500 bg-red-500/5',
    head: 'text-red-700 dark:text-red-300',
  },
};

function Admonition({ kind, title, children }: { kind: string; title?: string; children: ReactNode }) {
  const known = ADMONITIONS[kind.toLowerCase()];
  const Icon = known?.icon ?? Info;
  const heading = title ?? known?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
  return (
    <div
      data-admonition={kind}
      className={`my-3 rounded-md border-l-4 px-3 py-2 ${known?.band ?? 'border-border bg-muted/40'}`}
    >
      <div className={`mb-1 flex items-center gap-1.5 text-[12px] font-semibold ${known?.head ?? 'text-foreground'}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{heading}</span>
      </div>
      {children}
    </div>
  );
}

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
  // The sentence a conflict points at, in place.
  mark: ({ node, children }) => (
    <mark
      data-sentence={node?.properties?.[SENTENCE_MARK]}
      className="rounded-sm bg-amber-500/20 px-0.5 text-foreground ring-1 ring-amber-500/50"
    >
      {children}
    </mark>
  ),
  // The container a `:::type` directive was turned into, or the band around a
  // code block a conflict's sentence lies in — every other div (raw HTML
  // alignment wrappers) passes through untouched.
  div: ({ node, children, ...props }) => {
    const sentence = node?.properties?.[SENTENCE_MARK];
    if (typeof sentence === 'string') {
      return (
        <div data-sentence={sentence} className="-mx-2 my-1 rounded border-l-4 border-amber-500 bg-amber-500/10 px-2 py-1">
          {children}
        </div>
      );
    }
    const kind = node?.properties?.[ADMONITION_KIND];
    if (typeof kind !== 'string') return <div {...props}>{children}</div>;
    const title = node?.properties?.[ADMONITION_TITLE];
    return (
      <Admonition kind={kind} title={typeof title === 'string' ? title : undefined}>
        {children}
      </Admonition>
    );
  },
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

const NO_MARKS: readonly SentenceRange[] = [];
type RemarkPlugins = NonNullable<Options['remarkPlugins']>;

export function DocMarkdown({ source, marks = NO_MARKS }: { source: string; marks?: readonly SentenceRange[] }): ReactNode {
  const remarkPlugins = useMemo(
    (): RemarkPlugins => [remarkGfm, remarkDirective, remarkFrontmatter, remarkAdmonitions, [remarkSentenceMarks, marks]],
    [marks],
  );
  return (
    <div className="text-[13px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]]}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
