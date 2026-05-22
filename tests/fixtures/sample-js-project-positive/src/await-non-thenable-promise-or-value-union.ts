/**
 * Positive fixture for bugs/deterministic/await-non-thenable.
 *
 * The "value-or-promise" union `Promise<T> | T` (often hidden behind an
 * alias) is a perfectly legitimate `await` target — awaiting the value
 * branch is a no-op, awaiting the promise branch unwraps it. The TS
 * compiler is free to serialize the union with either side first and to
 * print the alias name in place of the expansion, so the visitor must
 * recurse into the union's constituent types rather than peek at the
 * string head.
 */

type ClipboardPayload = Promise<string> | string;

export const writeClipboard = async (
  value: ClipboardPayload,
  sink: (resolved: string) => void,
): Promise<void> => {
  sink(await value);
};

declare const fetchOrCached: () => Promise<number> | number;

export const consumeCounter = async (
  sink: (next: number) => void,
): Promise<void> => {
  sink(await fetchOrCached());
};
