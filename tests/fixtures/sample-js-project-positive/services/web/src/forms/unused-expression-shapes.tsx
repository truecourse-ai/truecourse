/**
 * unused-expression shape that should NOT fire:
 *
 * Ternary used as a statement to dispatch one of two side-effect
 * calls — equivalent to `if (cond) doA(x); else doB(x);`. The
 * value is intentionally discarded; neither arm is "unused".
 */

declare const writeToClipboard: (text: string) => Promise<void>;
declare const writeViaLegacy: (text: string) => Promise<void>;

export async function copy(text: string, modern: boolean): Promise<void> {
  modern ? await writeToClipboard(text) : await writeViaLegacy(text);
}
