// Paraphrased from documenso/documenso (apps/remix/.../use-scroll-to-page.ts,
// packages/ui/.../canvas.ts, packages/email/.../mailchannels.ts,
// packages/lib/.../use-autosave.ts).
//
// `void` as the RETURN type of a callback parameter type is valid. The rule
// should only flag `void` when it is the direct type of the parameter itself.

type Canvas = { width: number; height: number };
type SentInfo = { messageId: string };

export function registerScrollObserver(
  containerRef: { current: HTMLElement | null },
  scrollToItem: (index: number) => void,
): void {
  if (!containerRef.current) return;
  scrollToItem(0);
}

export function registerOnChangeHandler(
  handler: (_canvas: Canvas, _cleared: boolean) => void,
): void {
  handler({ width: 1, height: 1 }, false);
}

export function sendMail(
  callback: (_err: Error | null, _info: SentInfo) => void,
): void {
  callback(null, { messageId: 'x' });
}

export function scheduleSave(
  data: SentInfo,
  onResponse?: (response: SentInfo) => void,
): void {
  if (onResponse) onResponse(data);
}

// Generic argument position — `void` inside `Promise<void>` is also valid.
export async function awaitNothing(p: Promise<void>): Promise<void> {
  await p;
}
