
// --- argument-type-mismatch shape: dynamic import with template literal path ---
declare function getNodeEnv(): string;

export async function loadTranslationBundle(locale: string): Promise<Record<string, string>> {
  const ext = getNodeEnv() === 'development' ? 'po' : 'mjs';
  const { messages } = await import(`../locales/${locale}/app.${ext}`);
  return messages;
}

export async function activateLocale(locale: string): Promise<void> {
  const messages = await loadTranslationBundle(locale);
  console.log('Activated locale', locale, 'with', Object.keys(messages).length, 'messages');
}
