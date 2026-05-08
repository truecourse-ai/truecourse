/**
 * nested-template-literal shape that should NOT fire:
 *
 * `${msg`...`}` / `${i18n._(msg`...`)}` — Lingui / i18next
 * tagged-template DSL inside a string template. The inner
 * template is a tagged-template expression, which is the
 * library's API surface; the developer can't extract it to
 * a variable without losing the macro's compile-time
 * extraction (Lingui collects strings from the AST shape).
 */

declare const msg: (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>) => { id: string };
declare const i18n: { _(m: { id: string }): string };

export function notifyMessage(name: string): string {
  return `Notification: ${i18n._(msg`Hello ${name}`)}`;
}

export function plainLabel(name: string): string {
  return `Welcome, ${name}!`;
}
