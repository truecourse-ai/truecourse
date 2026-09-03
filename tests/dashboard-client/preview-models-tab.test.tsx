/**
 * Settings → Models, the real one.
 *
 * The tab reads and writes the workspace's LLM provider over the dashboard's
 * own routes. Three things carry the whole feature: the stored config arrives
 * MASKED (the key never comes back, only its tail, so an untouched key field
 * means "keep it"), saving is a live provider TEST the server refuses on the
 * provider's behalf, and that refusal is shown in the provider's own words —
 * paraphrasing it would throw away the only sentence that says what to change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LlmConfigResponse, LlmProviderConfigView } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import PreviewApp from '@/preview/PreviewApp';

const realFetch = window.fetch;

const STORED: LlmProviderConfigView = {
  provider: 'anthropic',
  model: 'claude-opus-5',
  fallbackModel: null,
  baseURL: null,
  region: null,
  accessKeyId: null,
  hasKey: true,
  keyMask: '••••7f21',
  updatedAt: '2026-08-30T09:00:00.000Z',
};

const PROVIDERS = ['anthropic', 'openai', 'bedrock', 'copilot'] as const;

interface Patch {
  body: Record<string, unknown>;
}

/**
 * A server holding one config. `onPatch` decides what the write answers, which
 * is where the probe lives: the route saves nothing until the provider answers.
 */
function serve(
  config: LlmProviderConfigView | null,
  onPatch: (patch: Patch) => Response = () => json({ config, providers: PROVIDERS }),
) {
  const patches: Patch[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/llm/config') {
      if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
        const patch: Patch = { body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> };
        patches.push(patch);
        return onPatch(patch);
      }
      return json({ config, providers: PROVIDERS } satisfies LlmConfigResponse);
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return patches;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderModels() {
  const path = '/preview/settings/models';
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Models tab', () => {
  it('loads the stored config masked, and never shows the key itself', async () => {
    serve(STORED);
    renderModels();

    const model = await screen.findByLabelText<HTMLInputElement>('Model');
    await waitFor(() => expect(model.value).toBe('claude-opus-5'));
    expect(screen.getByLabelText<HTMLSelectElement>('Provider').value).toBe('anthropic');
    // The stored key is present only as its tail, in the placeholder.
    const key = screen.getByLabelText<HTMLInputElement>('API key');
    expect(key.value).toBe('');
    expect(key.placeholder).toContain('••••7f21');
    // And the active-provider summary says the same thing.
    expect(screen.getByText('••••7f21')).toBeInTheDocument();
  });

  it('keeps the stored key when the field is left blank', async () => {
    const patches = serve(STORED, () =>
      json({ config: { ...STORED, model: 'claude-opus-5-fast' }, providers: PROVIDERS }),
    );
    renderModels();
    const user = userEvent.setup();

    const model = await screen.findByLabelText<HTMLInputElement>('Model');
    await waitFor(() => expect(model.value).toBe('claude-opus-5'));
    await user.clear(model);
    await user.type(model, 'claude-opus-5-fast');
    await user.click(screen.getByRole('button', { name: 'Test & save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toEqual({ provider: 'anthropic', model: 'claude-opus-5-fast' });
    // The saved state is the masked one the server answered with.
    expect(await screen.findByText('Verified and saved')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-5-fast')).toBeInTheDocument();
  });

  it('sends the key that was typed, and the bedrock fields when bedrock is picked', async () => {
    const patches = serve(null);
    renderModels();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText('Provider'), 'bedrock');
    await user.type(screen.getByLabelText('Model'), 'anthropic.claude-opus-5');
    // On bedrock the key field IS the AWS secret, and the region rides with it.
    await user.type(screen.getByLabelText('AWS secret access key'), 'shh');
    await user.type(screen.getByLabelText('AWS region'), 'us-east-1');
    await user.click(screen.getByRole('button', { name: 'Test & save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toEqual({
      provider: 'bedrock',
      model: 'anthropic.claude-opus-5',
      apiKey: 'shh',
      region: 'us-east-1',
    });
  });

  it('shows the provider test failure in the provider own words', async () => {
    serve(STORED, () =>
      json(
        { error: 'Provider test failed: 401 authentication_error: invalid x-api-key' },
        400,
      ),
    );
    renderModels();
    const user = userEvent.setup();

    const key = await screen.findByLabelText('API key');
    await user.type(key, 'sk-wrong');
    await user.click(screen.getByRole('button', { name: 'Test & save' }));

    expect(
      await screen.findByText('Provider test failed: 401 authentication_error: invalid x-api-key'),
    ).toBeInTheDocument();
    // Nothing was saved, so nothing claims it was.
    expect(screen.queryByText('Verified and saved')).toBeNull();
  });

  it('offers the providers the server named', async () => {
    serve(null);
    renderModels();

    const select = await screen.findByLabelText<HTMLSelectElement>('Provider');
    expect([...select.options].map((o) => o.value)).toEqual([...PROVIDERS]);
  });
});
