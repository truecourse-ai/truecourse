/**
 * THE LIVE SCREENS of the interfaces step — the running app the authoring
 * sessions observe, opened once for the step and closed with it.
 *
 * What it takes to show a session a screen the way a signed-in user sees it is
 * the first half of what a run does: install and build the app (a fresh clone
 * has nothing to serve), bring the services up, run the seed so the world
 * holds the rows and the principals the tests will reference, boot the web
 * surface, launch a browser and put a seeded credential into it — one browser
 * context per web session the seed minted, each described in the seed's own
 * words, and one signed out. Every piece
 * is the runner's own (`runSeed`, `startWebSurface`, `launchWebBrowser`), and
 * so is the world they run in (`observationWorld`): the seed gets the provided
 * external accounts on top of the default server's env and masks their
 * secrets, the surface's sandbox gets the accounts and every provided
 * dependency's registration, so a screen observed here is the screen a
 * scenario will drive.
 *
 * A world that cannot be stood up is a REASON, never a failure: the step
 * records why the screens were not observed and the sessions author from
 * source, exactly as they did before observation existed. Whatever came up
 * before the refusal is torn down again.
 */

import {
  DEFAULT_BUILD_TIMEOUT_MS,
  DEFAULT_INSTALL_TIMEOUT_MS,
  createSandbox,
  createWebObserver,
  launchWebBrowser,
  observationWorld,
  preflightBrowser,
  resolveApiServers,
  resolveWebSurface,
  runBuild,
  runInstall,
  runSeed,
  startWebSurface,
  type Recipe,
  type ResolvedCredential,
} from '@truecourse/guard-runner';
import { ANONYMOUS_PRINCIPAL } from '@truecourse/shared';
import { publicFixtureFields, type LiveScreenObserver, type LiveScreens } from '../interface-author/live-screen.js';
import { DEFAULT_WEB_PRINCIPAL } from '../interface-author/principals.js';
import { outputTail, servicesController } from './services-lifecycle.js';

export interface OpenLiveScreensOptions {
  repoRoot: string;
  /** The recipe as it stands after the seed step — its `api.seed` is what mints the principal. */
  recipe: Recipe;
  signal?: AbortSignal;
  /** The live phase line: what is running now, and what to call it when done. */
  onPhase?: (running: string, done: string) => void;
}

export type OpenLiveScreensResult =
  | {
      ok: true;
      live: LiveScreens;
      /** Tear the whole world down: pages, browser, surface, services. Idempotent. */
      close(): Promise<void>;
    }
  | { ok: false; reason: string };

/**
 * Stand the app up and hand back an observer over it. Runs the recipe's
 * install and build first: the interfaces step may be the first thing in a
 * clone that boots anything (the seed step it follows is skipped when
 * settled), and an unbuilt app boots nothing.
 */
export async function openSetupLiveScreens(opts: OpenLiveScreensOptions): Promise<OpenLiveScreensResult> {
  const { repoRoot, recipe, signal } = opts;
  const surface = resolveWebSurface(recipe);
  if (!surface) return { ok: false, reason: 'the recipe declares no `web` block, so there is no screen to serve' };
  const browserReady = await preflightBrowser();
  if (!browserReady.ok) return { ok: false, reason: browserReady.reason };

  const phase = (running: string, done: string): void => opts.onPhase?.(running, done);

  // The app is BUILT before anything boots it, the way the seed step builds
  // before its probes: a checkout that never ran the recipe's build has
  // nothing to serve.
  if (recipe.install) {
    phase(`installing the app (\`${recipe.install}\`)`, 'install');
    const installed = await runInstall(repoRoot, recipe.install, recipe.env, DEFAULT_INSTALL_TIMEOUT_MS, signal);
    if (!installed.ok) return { ok: false, reason: `the recipe \`install\` failed: ${outputTail(installed.output)}` };
  }
  if (recipe.build) {
    phase(`building the app (\`${recipe.build}\`)`, 'build');
    const built = await runBuild(repoRoot, recipe.build, recipe.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
    if (!built.ok) return { ok: false, reason: `the recipe \`build\` failed: ${outputTail(built.output)}` };
  }
  if (surface.build) {
    phase(`building the web surface (\`${surface.build}\`)`, 'web build');
    const built = await runBuild(repoRoot, surface.build, surface.env, DEFAULT_BUILD_TIMEOUT_MS, signal);
    if (!built.ok) return { ok: false, reason: `the recipe \`web.build\` failed: ${outputTail(built.output)}` };
  }

  // What is up so far, torn down in reverse on a refusal and on close.
  const teardown: (() => Promise<void>)[] = [];
  const closeAll = async (): Promise<void> => {
    while (teardown.length > 0) await teardown.pop()!().catch(() => undefined);
  };
  const refuse = async (reason: string): Promise<OpenLiveScreensResult> => {
    await closeAll();
    return { ok: false, reason };
  };

  try {
    const world = observationWorld(repoRoot, recipe.api?.externals);
    const services = servicesController(repoRoot, recipe, signal);
    if (recipe.api?.services) {
      phase(`starting the services (\`${recipe.api.services.up}\`)`, 'services up');
      await services.up();
      teardown.push(() => services.down());
    }

    // The seed: the rows the screens list, and the principal the browser is
    // signed in as. Its env is the default server's with the accounts on top,
    // exactly as a run's is.
    let credentials = new Map<string, ResolvedCredential>();
    let fixtures = new Map<string, Record<string, unknown>>();
    if (recipe.api?.seed) {
      phase(`running the seed (\`${recipe.api.seed.command}\`)`, 'seed');
      const servers = resolveApiServers(recipe);
      const server = servers.servers.get(servers.defaultServer);
      const seeded = await runSeed({
        repoRoot,
        seed: recipe.api.seed,
        env: { ...(server?.env ?? recipe.env ?? {}), ...world.serverEnv },
        externalSecrets: world.secrets,
        timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      credentials = seeded.credentials;
      fixtures = seeded.fixtures;
    }

    phase(`serving the web surface (\`${surface.serve.join(' ')}\`)`, 'web surface');
    const sandbox = createSandbox({
      recipeEnv: { ...surface.env, ...world.env },
      repoRoot,
      ...(recipe.expose ? { expose: recipe.expose } : {}),
      supplied: world.supplied,
    });
    teardown.push(async () => sandbox.cleanup());
    const served = await startWebSurface({
      surface,
      repoRoot,
      sandboxCwd: sandbox.cwd,
      sandboxEnv: sandbox.env,
      ...(signal ? { signal } : {}),
    });
    if (!served.ok) {
      const output = [served.stderr.trim(), served.stdout.trim()].filter(Boolean).join('\n');
      return refuse(`the web surface would not boot: ${served.reason}${output ? ` — ${outputTail(output)}` : ''}`);
    }
    const server = served.server;
    teardown.push(async () => {
      await server.drain();
      await server.stop();
    });

    phase('opening a browser on the served surface', 'browser');
    const launched = await launchWebBrowser({});
    if (!launched.ok) return refuse(launched.reason);
    const browser = launched.browser;
    teardown.push(async () => {
      await browser.close();
    });

    // The principals: one observer per web session the seed minted (a Cookie
    // credential is what a signed-in browser carries; any other header still
    // rides every request when that is all there is), the first the default,
    // and a signed-out browser beside them.
    const principals = new Map<string, LiveScreenObserver>();
    for (const principal of webPrincipals(credentials)) {
      const observer = await createWebObserver({ browser, baseUrl: server.baseUrl, credential: principal });
      if (!observer.ok) return refuse(observer.reason);
      teardown.push(() => observer.observer.close());
      principals.set(principal.name, observer.observer);
    }
    const anonymous = await createWebObserver({ browser, baseUrl: server.baseUrl });
    if (!anonymous.ok) return refuse(anonymous.reason);
    teardown.push(() => anonymous.observer.close());
    principals.set(ANONYMOUS_PRINCIPAL, anonymous.observer);

    const publicFixtures = publicFixtureFields(fixtures);
    const descriptions = principalDescriptions(recipe);
    return {
      ok: true,
      live: {
        observer: principals.values().next().value ?? anonymous.observer,
        principals,
        ...(descriptions.size > 0 ? { descriptions } : {}),
        ...(Object.keys(publicFixtures).length > 0 ? { fixtures: publicFixtures } : {}),
      },
      close: closeAll,
    };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The credentials a browser can sign in with, the default first: every Cookie
 * credential, the owner of the seeded data (`webSession`) first and the others
 * by name, else the first credential there is.
 */
export function webPrincipals(
  credentials: ReadonlyMap<string, ResolvedCredential>,
): { name: string; credential: ResolvedCredential }[] {
  const usable = [...credentials].filter(([, credential]) => credential.value.length > 0);
  const cookies = usable.filter(([, credential]) => credential.header.toLowerCase() === 'cookie');
  const rank = (name: string): number => (name === DEFAULT_WEB_PRINCIPAL ? 0 : 1);
  return (cookies.length > 0 ? [...cookies].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)) : usable.slice(0, 1))
    .map(([name, credential]) => ({ name, credential }));
}

/** What the seed says makes each principal it mints distinct: its credentials' descriptions, by name. */
function principalDescriptions(recipe: Recipe): Map<string, string> {
  return new Map(
    Object.entries(recipe.api?.seed?.provides.credentials ?? {}).flatMap(([name, credential]) =>
      credential.description ? [[name, credential.description] as const] : [],
    ),
  );
}
