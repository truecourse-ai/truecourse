

// --- missing-return-type shape: async-utility-function-promise-void ---
declare const i18n: { loadAndActivate: (opts: { locale: string; messages: unknown }) => void };
declare function getTranslations(locale: string): Promise<unknown>;

export async function dynamicActivate(locale: string) {
  const messages = await getTranslations(locale);
  i18n.loadAndActivate({ locale, messages });
}

export async function preloadLocale(locale: string) {
  await getTranslations(locale);
}
