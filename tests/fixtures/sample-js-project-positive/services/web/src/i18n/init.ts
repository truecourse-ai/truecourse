/**
 * i18next initialization. The chained `i18n.use(...).use(...).init(...)`
 * builder returns a Promise that the library docs explicitly say to
 * fire-and-forget at module top level. The floating-promise rule must
 * not flag this idiom.
 *
 * Mirrors OpenHands'
 *   frontend/src/i18n/index.ts:24
 *   frontend/test-utils.tsx:42
 * where 2/3 floating-promise hits remained after the React-Query
 * allowlist landed.
 */

interface I18nLike {
  use(plugin: unknown): I18nLike;
  init(opts: object): Promise<unknown>;
}

declare const i18n: I18nLike;
declare const Backend: unknown;
declare const LanguageDetector: unknown;
declare const initReactI18next: unknown;

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: false,
  });
