/**
 * ONE HTTP METHOD, in its own colour — the label an api row leads with.
 *
 * A path list is skimmed for one thing: what this operation DOES to the noun. The
 * verb answers it, and colour is the only encoding that survives a skim of forty
 * rows, so the six methods get six hues rather than a bright/quiet split. They are
 * TOKENS, defined once here and worn identically by the panel's rows, the pane's
 * header and the "also on this endpoint" chips — a method must never read two
 * ways in one tab.
 *
 * The hues are the same lightness and chroma (`oklch(0.72 0.11 h)`) apart from
 * DELETE, which is the one verb that destroys and is allowed to sit brighter and
 * redder. Nothing here claims a SEVERITY: a colour distinguishes verbs, and the
 * catalog established no danger ranking for anyone to read off it.
 *
 * A verb outside the six (an unknown method is a catalog fact, never rounded to a
 * neighbour) wears the muted foreground — visible, uncoloured, and obviously not
 * one of the six.
 */

/** The six methods, as Tailwind colour utilities. Extend here, nowhere else. */
export const GUARD_METHOD_COLOR: Record<string, string> = {
  GET: 'text-[oklch(0.72_0.11_230)]',
  POST: 'text-[oklch(0.72_0.11_155)]',
  PUT: 'text-[oklch(0.72_0.11_70)]',
  PATCH: 'text-[oklch(0.72_0.11_185)]',
  DELETE: 'text-[oklch(0.68_0.14_25)]',
  HEAD: 'text-[oklch(0.72_0.11_300)]',
};

export function guardMethodColor(method: string): string {
  return GUARD_METHOD_COLOR[method.toUpperCase()] ?? 'text-muted-foreground';
}

/**
 * `fixed` reserves one column width for the verb so the PATHS beside it line up
 * down a long list — the thing a reader is actually scanning. Off it, the label
 * is as wide as its word (a header, a chip).
 */
export function GuardMethodLabel({
  method,
  fixed = false,
  size = 'sm',
}: {
  method: string;
  fixed?: boolean;
  size?: 'sm' | 'md';
}) {
  const verb = method.toUpperCase();
  return (
    <span
      className={`shrink-0 font-mono font-bold tracking-wide ${guardMethodColor(verb)} ${
        size === 'md' ? 'text-[12px]' : 'text-[10px]'
      }${fixed ? ' w-11' : ''}`}
    >
      {verb}
    </span>
  );
}
