

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


// FP shape: dynamic import with template literal path — valid dynamic import;
// no type mismatch between the import path and the expected module shape.
declare function getEnvironment(): string;

export async function loadLocaleBundle(locale: string): Promise<Record<string, string>> {
  const ext = getEnvironment() === 'development' ? 'po' : 'mjs';
  const { messages } = await import(`../translations/${locale}/app.${ext}`);
  return messages as Record<string, string>;
}

export async function activateLocale(locale: string): Promise<void> {
  const messages = await loadLocaleBundle(locale);
  console.info(`[i18n] Activated locale ${locale} with ${Object.keys(messages).length} keys`);
}

