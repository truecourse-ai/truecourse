/**
 * Anonymous-callback array access. The callbacks here are passed to
 * `useCallback`, `.map`, etc. — the caller controls the iteration,
 * so the index is provably bounded by the array's length. The
 * unchecked-array-access rule must NOT fire on these shapes.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/embed/authoring/configure-fields-view.tsx:352,382,411
 *   apps/remix/app/components/general/envelope-editor/envelope-editor-recipient-form.tsx:326,488
 *   apps/remix/app/components/general/pdf-viewer/pdf-viewer.tsx:249,278
 *
 * Declared functions taking an arbitrary `i: number` parameter still
 * need bounds checks (the negative fixture covers that case).
 */

interface Field {
  readonly id: string;
  readonly pageNumber: number;
}

declare const wrapHandler: <H>(handler: H) => H;

export function buildFieldHandlers(localFields: readonly Field[]): {
  readonly onResize: (idx: number) => string;
  readonly summarize: () => readonly number[];
} {
  // wrapHandler stand-in for useCallback / useMemo — caller iterates
  // fields and passes the index, so the bounds are guaranteed.
  const onResize = wrapHandler((index: number): string => {
    const field = localFields[index];
    return `field-${field.id}`;
  });

  // Direct .map callback.
  const summarize = (): readonly number[] => localFields.map((_, idx) => localFields[idx].pageNumber);

  return { onResize, summarize };
}
