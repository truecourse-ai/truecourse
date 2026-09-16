/**
 * The analytics module: what it sends, and the two conditions under which it
 * sends nothing.
 *
 * Every helper answers to one `initialized` flag, so the contract worth pinning
 * is that flag: before `initPostHog`, and with the build's opt-out set, nothing
 * reaches PostHog at all. The rest is shape — the source tag every event
 * carries, the distinct id a person is named by, and the workspace group.
 *
 * Each case loads a FRESH copy of the module (`vi.resetModules`), because that
 * flag is module state and a test that inherited it would prove nothing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  group: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

const DEFAULT_KEY = 'phc_ys9Ykf49KmNqAC3fhq3jugTejc4BDqyKqRS8qRoYZYew';

/** A fresh module, so `initialized` starts false. */
async function load() {
  vi.resetModules();
  return import('@/lib/posthog');
}

/** The config `posthog.init` was handed. */
function initConfig(): Record<string, unknown> {
  return posthog.init.mock.calls[0]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('initPostHog', () => {
  it('starts the client once, on the shared project', async () => {
    const { initPostHog } = await load();
    initPostHog();
    initPostHog();

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init.mock.calls[0]?.[0]).toBe(DEFAULT_KEY);
    expect(initConfig()).toMatchObject({
      api_host: 'https://us.i.posthog.com',
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
    });
  });

  it('tags everything this client sends as the dashboard', async () => {
    const { initPostHog } = await load();
    initPostHog();

    (initConfig().loaded as (ph: typeof posthog) => void)(posthog);
    expect(posthog.register).toHaveBeenCalledWith({ source: 'dashboard' });
  });

  it('takes another project from the build', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_staging');
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://posthog.internal');
    const { initPostHog } = await load();
    initPostHog();

    expect(posthog.init.mock.calls[0]?.[0]).toBe('phc_staging');
    expect(initConfig()).toMatchObject({ api_host: 'https://posthog.internal' });
  });

  it('does nothing at all with the opt-out set, and leaves every helper silent', async () => {
    vi.stubEnv('VITE_POSTHOG_DISABLED', '1');
    const mod = await load();
    mod.initPostHog();
    mod.trackEvent(mod.EVENTS.scanStarted);
    mod.trackPageview('/code');
    mod.identifyUser({ id: 'user_1', email: 'dana@acme.dev' });
    mod.resetUser();

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe('before the client is started', () => {
  it('sends nothing rather than throwing', async () => {
    const mod = await load();
    mod.trackEvent(mod.EVENTS.runStarted, { repoId: 'repo_1' });
    mod.trackPageview('/flows');
    mod.identifyUser({ id: 'user_1', email: 'dana@acme.dev' });
    mod.resetUser();

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.group).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe('once it is started', () => {
  it('sends a named event with its properties', async () => {
    const mod = await load();
    mod.initPostHog();
    mod.trackEvent(mod.EVENTS.repoConnected, { repo: 'acme/orders', provider: 'github' });

    expect(posthog.capture).toHaveBeenCalledWith('repo_connected', {
      repo: 'acme/orders',
      provider: 'github',
    });
  });

  it('sends a pageview as a full address', async () => {
    const mod = await load();
    mod.initPostHog();
    mod.trackPageview('/code?repo=acme');

    expect(posthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.location.origin}/code?repo=acme`,
    });
  });

  it('names the person by their user id, and their workspace as a group', async () => {
    const mod = await load();
    mod.initPostHog();
    mod.identifyUser({
      id: 'user_1',
      email: 'dana@acme.dev',
      name: 'Dana Rees',
      workspaceId: 'org_1',
      workspaceName: 'Northwind Labs',
    });

    expect(posthog.identify).toHaveBeenCalledWith('user_1', {
      email: 'dana@acme.dev',
      name: 'Dana Rees',
    });
    expect(posthog.group).toHaveBeenCalledWith('workspace', 'org_1', { name: 'Northwind Labs' });
  });

  it('falls back to the email when the session carries no id, and groups nobody without a workspace', async () => {
    const mod = await load();
    mod.initPostHog();
    mod.identifyUser({ email: 'dana@acme.dev' });

    expect(posthog.identify).toHaveBeenCalledWith('dana@acme.dev', { email: 'dana@acme.dev' });
    expect(posthog.group).not.toHaveBeenCalled();
  });

  it('ends the identity on demand', async () => {
    const mod = await load();
    mod.initPostHog();
    mod.resetUser();

    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});

describe('the event catalogue', () => {
  it('names every event in snake_case, once', async () => {
    const { EVENTS } = await load();
    const names = Object.values(EVENTS);

    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(new Set(names).size).toBe(names.length);
  });
});
