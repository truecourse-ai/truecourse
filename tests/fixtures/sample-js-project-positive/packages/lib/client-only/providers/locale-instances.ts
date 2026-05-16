
// FP: {}) as AllLocaleInstances — reduce accumulator starts as {} and is faithfully built
// by iterating all supported locales. TypeScript can't infer the accumulator type from the seed.
declare const SUPPORTED_LOCALES: readonly string[];
declare function setupFormatter(locale: string): { format: (val: unknown) => string };

type AllLocaleInstances = { [K in string]: { format: (val: unknown) => string } };

const allLocaleInstances = SUPPORTED_LOCALES.reduce((acc, locale) => {
  const formatter = setupFormatter(locale);
  return { ...acc, [locale]: formatter };
}, {}) as AllLocaleInstances;
