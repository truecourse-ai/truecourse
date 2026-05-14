
// --- FP shape: top-level async entry-point called without await at module boundary ---
declare function hydrateRoot(container: Element, element: unknown): void;
declare function createRoot(container: Element): { render(el: unknown): void };
declare const document: { getElementById(id: string): Element | null };

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) return;
  hydrateRoot(container, null);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();



// --- FP shape: top-level async main function returning Promise<void>; entry-point side-effect, not a public API ---
declare function dynamicActivate(locale: string): Promise<void>;
declare function startTransition(fn: () => void): void;
declare function hydrateClient(el: unknown): void;
declare const document: { documentElement: { lang: string } };

async function main() {
  const locale = document.documentElement.lang || 'en';
  await dynamicActivate(locale);
  startTransition(() => {
    hydrateClient(null);
  });
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();



// --- FP shape: internal React component returning null; trivially inferred, private to entry module ---
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare const analytics: { init(key: string): void };
declare const ENV: { ANALYTICS_KEY?: string };

function AnalyticsInit() {
  useEffect(() => {
    if (ENV.ANALYTICS_KEY) {
      analytics.init(ENV.ANALYTICS_KEY);
    }
  }, []);

  return null;
}
