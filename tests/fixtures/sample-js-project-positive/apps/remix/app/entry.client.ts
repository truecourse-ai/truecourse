
// FP: top-level async main() called with // eslint-disable-next-line @typescript-eslint/no-floating-promises
// The comment explicitly acknowledges the pattern; not a bug.
declare function detectLocale(): string;
declare function activateLocale(locale: string): Promise<void>;
declare function hydrateApp(): Promise<void>;

async function main() {
  const locale = detectLocale() || 'en';
  await activateLocale(locale);
  await hydrateApp();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();



// Top-level main() call in browser entry point — top-level await unavailable in this context,
// floating call is the only viable pattern for async hydration entry
declare function hydrateReactApp(): Promise<void>;

async function main() {
  await hydrateReactApp();
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
