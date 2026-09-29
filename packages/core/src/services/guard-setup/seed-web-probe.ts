/**
 * Browser proof for a web seed credential, used when both HTTP loads return
 * HTML: a single-page app serves its shell before its router checks the
 * session, so the shell's status proves nothing.
 *
 * The route is loaded in two isolated contexts of one browser. With the
 * credential the browser must end on the route or a child of it; without it
 * the load must be refused over HTTP or end on a DIFFERENT page. Comparing
 * the two landings is what refuses a bad cookie when the login page sits
 * under the route (/admin -> /admin/login).
 *
 * - A landing is its path and fragment (/#/dashboard), never its query.
 * - A signed-in load that is sent away is reloaded, since a guard can race
 *   its own data. Nothing on the page is clicked.
 * - A slow guard gets time: the anonymous load may take {@link GUARD_WAIT_MS}
 *   to leave, and the signed-in page is read again before the verdict.
 * - A page error decides nothing; it is reported beside a refusal.
 *
 * No model, no login actions, no cached verdict. The browser is closed on
 * every exit.
 */
import {
  WEB_CONTEXT_OPTIONS,
  installWebCredential,
  launchWebBrowser,
  samePage,
  settlePage,
  type ResolvedCredential,
  type WebBrowserHandle,
} from '@truecourse/guard-runner';

type Page = WebBrowserHandle['page'];

/** Wall clock for one document load. */
const NAVIGATION_TIMEOUT_MS = 15_000;
/** How many times a signed-in load is repeated after the first is sent away. */
const SIGNED_IN_RELOADS = 2;
/** How long an anonymous load may take to be sent away from the signed-in landing. */
const GUARD_WAIT_MS = 10_000;

/** Where one load ended, and the page errors that load raised. */
interface Landing {
  status: number;
  url: URL;
  pageErrors: readonly string[];
}

/** A landing as it is compared and named: the path, and the route a hash router keeps in the fragment. */
function addressOf(url: URL): string {
  return `${url.pathname}${url.hash.split('?')[0]}`;
}

export async function probeSeedWebPage(opts: {
  baseUrl: string;
  path: string;
  name: string;
  credential: ResolvedCredential;
  signal?: AbortSignal;
}): Promise<{ ok: true; line: string } | { ok: false; reason: string }> {
  const target = new URL(opts.path, opts.baseUrl);
  const route = addressOf(target);
  const targetFragment = target.hash.split('?')[0];
  const cancelled = { ok: false as const, reason: `browser probe for "${opts.name}" was cancelled` };
  const within = (at: string, root: string): boolean =>
    at === root || at.startsWith(`${root.replace(/\/+$/, '')}/`);
  const onProtectedRoute = (url: URL): boolean => {
    if (url.origin !== target.origin) return false;
    if (targetFragment) return samePage(url.toString(), new URL(target.pathname, target)) && within(url.hash.split('?')[0], targetFragment);
    return within(url.pathname.replace(/\/+$/, '') || '/', target.pathname.replace(/\/+$/, '') || '/');
  };
  // A probe of `/` has every page of the app below it, so for that probe this
  // comparison is the whole proof.
  const sameLanding = (a: URL, b: URL): boolean =>
    samePage(a.toString(), new URL(b.pathname, b)) && a.hash.split('?')[0] === b.hash.split('?')[0];

  /** Collect one page's errors; every load of that page reports them. */
  const watch = (page: Page): { page: Page; pageErrors: string[] } => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message.split('\n')[0].slice(0, 200)));
    return { page, pageErrors };
  };
  // A load that only moves the fragment fetches no document and so answers
  // with no response: the document it stays in is the one `earlier` loaded.
  const visit = async (watched: ReturnType<typeof watch>, earlier?: Landing): Promise<Landing> => {
    if (opts.signal?.aborted) throw new Error('probe cancelled');
    const response = await watched.page.goto(target.toString(), {
      waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS,
    });
    const status = response?.status() ?? earlier?.status;
    if (status === undefined) throw new Error('navigation returned no HTTP response');
    await settlePage(watched.page);
    return { status, url: new URL(watched.page.url()), pageErrors: watched.pageErrors };
  };
  // A repeated load may be answered from the browser's cache, revalidated
  // with a 304: the document was served all the same.
  const served = (landing: Landing): boolean =>
    (landing.status >= 200 && landing.status < 300) || landing.status === 304;
  const pageErrorNote = (load: string, landing: Landing): string =>
    landing.pageErrors.length > 0
      ? ` The ${load} load raised a JavaScript error (${landing.pageErrors[0]}), which may be why.`
      : '';

  if (opts.signal?.aborted) return cancelled;
  const launched = await launchWebBrowser({});
  if (!launched.ok) {
    return { ok: false, reason: `browser probe for "${opts.name}" could not verify ${route}: ${launched.reason}` };
  }
  const { browser } = launched;
  const abort = (): void => { void browser.close().catch(() => undefined); };
  opts.signal?.addEventListener('abort', abort, { once: true });
  try {
    // A cancel that arrived while the browser was launching fired before the
    // listener existed.
    if (opts.signal?.aborted) return cancelled;
    const installed = await installWebCredential(browser.page, opts.baseUrl, opts.name, opts.credential, {});
    if (!installed.ok) throw new Error(installed.reason);
    const signedInPage = watch(browser.page);
    let signedIn = await visit(signedInPage);
    for (let reload = 0; reload < SIGNED_IN_RELOADS && !onProtectedRoute(signedIn.url); reload++) {
      signedIn = await visit(signedInPage, signedIn);
    }
    if (!served(signedIn) || !onProtectedRoute(signedIn.url)) {
      return {
        ok: false,
        reason: `browser probe for "${opts.name}" did not reach the protected route ${route} with the credential: HTTP ${signedIn.status}, landed on ${addressOf(signedIn.url)}. Check the session cookie and choose the canonical signed-in route.${pageErrorNote('signed-in', signedIn)}`,
      };
    }
    // A second context of the same browser shares nothing with the first:
    // no cookies, no storage, no extra headers.
    const engine = browser.page.context().browser();
    if (!engine) throw new Error('the browser closed before the anonymous load');
    const anonymousContext = await engine.newContext({ ...WEB_CONTEXT_OPTIONS });
    const anonymousPage = watch(await anonymousContext.newPage());
    let anonymous = await visit(anonymousPage);
    if (served(anonymous) && sameLanding(anonymous.url, signedIn.url)) {
      const landing = signedIn.url;
      await anonymousPage.page
        .waitForURL((url) => !sameLanding(url, landing), { timeout: GUARD_WAIT_MS })
        .catch(() => undefined);
      await settlePage(anonymousPage.page);
      anonymous = { ...anonymous, url: new URL(anonymousPage.page.url()) };
    }
    signedIn = { ...signedIn, url: new URL(signedInPage.page.url()) };
    if (!onProtectedRoute(signedIn.url)) {
      return {
        ok: false,
        reason: `browser probe for "${opts.name}" was sent away from the protected route ${route} with the credential, to ${addressOf(signedIn.url)}. Check the session cookie and choose the canonical signed-in route.${pageErrorNote('signed-in', signedIn)}`,
      };
    }
    if (served(anonymous) && sameLanding(anonymous.url, signedIn.url)) {
      return {
        ok: false,
        reason: `browser probe ${route} lands on ${addressOf(anonymous.url)} both WITH and WITHOUT "${opts.name}" (HTTP ${anonymous.status}): either navigation does not gate it or the credential does not sign in. Pick a signed-in route whose anonymous browser load redirects or is refused; an inline login form cannot be proved by navigation alone.${pageErrorNote('signed-in', signedIn)}${pageErrorNote('anonymous', anonymous)}`,
      };
    }
    return {
      ok: true,
      line: `${opts.name}: browser ${route} → ${addressOf(signedIn.url)} with the credential, ${addressOf(anonymous.url)} (HTTP ${anonymous.status}) without; the HTML shell's 200 is not the auth verdict`,
    };
  } catch (error) {
    if (opts.signal?.aborted) return cancelled;
    return { ok: false, reason: `browser probe for "${opts.name}" could not verify ${route}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    await browser.close();
  }
}
