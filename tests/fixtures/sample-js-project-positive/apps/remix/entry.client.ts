
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


// argument-type-mismatch FP: hydrateRoot(document, <JSX>) — document is valid container, JSX element is valid React node
declare function hydrateRoot(container: Document | Element, ui: unknown): { unmount: () => void };
declare const StrictModeApp: unknown;

hydrateRoot(document, StrictModeApp);



// argument-type-mismatch FP: startTransition(() => { hydrateRoot(...) }) — startTransition takes void callback
declare function startTransition(callback: () => void): void;
declare function hydrateRootClient(container: Element, ui: unknown): void;
declare const rootContainer: Element;
declare const appComponent: unknown;

startTransition(() => {
  hydrateRootClient(rootContainer, appComponent);
});



// FP: initRemixClient expects mountNode: Element but document (Document) is passed
declare function initRemixClient(mountNode: Element, config: { ssr: boolean }): void;

initRemixClient(document, { ssr: true });



// FP: hydrateRemixApp expects rootId: number but receives string from env variable
declare function hydrateRemixApp(rootId: number, opts: { strict: boolean }): void;
declare const ROOT_ELEMENT_ID: string;

hydrateRemixApp(ROOT_ELEMENT_ID, { strict: true });

