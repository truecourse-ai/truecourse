/**
 * await-non-thenable shape that should NOT fire:
 *
 * `await` on a parameter typed `T | Promise<T>`. The
 * await-on-maybe-promise idiom is safe-by-spec (await on a
 * non-promise value resolves to that value), and refactoring
 * to a runtime `Promise.resolve(x)` wrap loses no semantics.
 */

declare const clipboardMaybe: (text: string | Promise<string>) => Promise<void>;

export async function copyToClipboard(text: string | Promise<string>): Promise<void> {
  const resolved = await text;
  await clipboardMaybe(resolved);
}
