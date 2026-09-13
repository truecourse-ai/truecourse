import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DependencyPage } from '@/preview/repo/DependencyPage';
import type { Repo } from '@/preview/data/types';
import type { GuardDependenciesView, GuardDependencyRow } from '@/preview/vendor/types/guard-dependencies';

vi.mock('@/lib/socket', () => ({ connectSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));

const repo = { id: 'expense-tracker', fullName: 'owner/expense-tracker' } as Repo;
const urlVar = 'CURRENCYBEACON_BASE_URL';
const keyVar = 'CURRENCYBEACON_API_KEY';
const origin = 'https://provider.test';

function serviceRow(): GuardDependencyRow {
  return {
    name: 'currencybeacon', class: 'supplied', summary: 'Currency conversion account',
    requirement: 'A base URL and API key', state: 'unprovided', needs: [], usedBy: 1, inCatalog: false,
    fields: [
      { field: urlVar, resolved: false, secret: false },
      { field: keyVar, resolved: false, secret: true },
    ],
    blocks: [{ flowId: 'convert', title: 'Convert currency', kind: 'not-authored' }],
    service: {
      service: 'currencybeacon', services: ['currencybeacon'], detected: true,
      declaredInRecipe: true, baseUrlEnv: urlVar, baseUrlEnvSource: 'recipe',
      baseUrl: null, endpoints: {}, tokenSet: false, headers: [], evidence: [], undeclaredLocalEnv: [],
    },
  };
}

function serve(row: GuardDependencyRow, fail = false) {
  const current: GuardDependenciesView = {
    catalogPath: '', localPath: '', recipePath: '', invalidReason: null,
    detectionAvailable: true, unknownLocalNames: [], dependencies: [row],
  };
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(init.body as string);
      writes.push(patch);
      if (fail) return new Response(JSON.stringify({ error: 'Credential could not be saved' }), { status: 422 });
      row.state = 'provided';
      row.service!.baseUrl = patch.baseUrl ?? patch.env?.[urlVar] ?? row.service!.baseUrl;
      row.fields = row.fields.map((field) => ({
        ...field, resolved: true, value: field.secret ? '•••• stored locally' : row.service!.baseUrl!,
      }));
    }
    return new Response(JSON.stringify(current));
  }));
  return writes;
}

function page() {
  return <MemoryRouter><DependencyPage repo={repo} name="currencybeacon" /></MemoryRouter>;
}

afterEach(() => vi.unstubAllGlobals());

describe('dependency registration', () => {
  it('saves only the declared URL and key, masks the saved key, and leaves generation in Tests', async () => {
    const writes = serve(serviceRow());
    render(page());
    const user = userEvent.setup();
    const url = await screen.findByLabelText(urlVar);
    const key = screen.getByLabelText(keyVar);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('placeholder', '');
    expect(screen.queryByLabelText('Base URL variable')).toBeNull();
    expect(screen.queryByLabelText('Authorization token')).toBeNull();
    expect(screen.queryByText('Custom headers')).toBeNull();
    expect(screen.queryByRole('button', { name: /generation/i })).toBeNull();
    await user.type(url, origin);
    await user.type(key, 'test-only-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(key).toHaveValue(''));
    expect(writes).toEqual([{ name: 'currencybeacon', baseUrlEnv: urlVar, baseUrl: origin, env: { [keyVar]: 'test-only-key' } }]);
    expect(url).toHaveValue(origin);
    expect(key).toHaveAttribute('placeholder', '•••• stored locally');
    expect(screen.queryByRole('button', { name: /generation/i })).toBeNull();
    // Updating the URL must not write the stored mask over the key.
    await user.clear(url);
    await user.type(url, 'https://other-provider.test');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual({ name: 'currencybeacon', baseUrlEnv: urlVar, baseUrl: 'https://other-provider.test' });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('renders a catalog URL once and saves it through the catalog registration', async () => {
    const row = serviceRow();
    row.inCatalog = true;
    row.registration = { kind: 'env', vars: [
      { name: urlVar, description: 'Service URL', secret: false },
      { name: keyVar, description: 'API key', secret: true },
    ] };
    const writes = serve(row);
    render(page());
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(urlVar), origin);
    await user.type(screen.getByLabelText(keyVar), 'catalog-key');
    expect(screen.getAllByLabelText(urlVar)).toHaveLength(1);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ name: 'currencybeacon', env: { [urlVar]: origin, [keyVar]: 'catalog-key' } });
    await waitFor(() => expect(screen.getByLabelText(keyVar)).toHaveValue(''));
    expect(screen.getByLabelText(urlVar)).toHaveValue(origin);
  });

  it('retains the service URL when the catalog only declares credentials', async () => {
    const row = serviceRow();
    row.registration = { kind: 'env', vars: [{ name: keyVar, description: 'API key', secret: true }] };
    row.fields = row.fields.filter((field) => field.secret);
    const writes = serve(row);
    render(page());
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(urlVar), origin);
    await user.type(screen.getByLabelText(keyVar), 'catalog-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ name: 'currencybeacon', baseUrl: origin, env: { [keyVar]: 'catalog-key' } });
  });

  it('keeps detected source details collapsed under Detected in code', async () => {
    const row = serviceRow();
    row.service!.evidence = [{ service: 'currencybeacon', filePath: 'lib/currencybeacon.ts', url: 'https://api.currencybeacon.com' }];
    serve(row);
    render(page());
    const toggle = await screen.findByRole('button', { name: 'Detected in code (1)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('lib/currencybeacon.ts')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('lib/currencybeacon.ts').closest('li')).toHaveTextContent('lib/currencybeacon.ts → https://api.currencybeacon.com');
  });

  it('keeps entered values when a save fails', async () => {
    serve(serviceRow(), true);
    render(page());
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(urlVar), origin);
    await user.type(screen.getByLabelText(keyVar), 'test-only-key');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Credential could not be saved');
    expect(screen.getByLabelText(urlVar)).toHaveValue(origin);
    expect(screen.getByLabelText(keyVar)).toHaveValue('test-only-key');
  });

  it('does not invent a URL variable for a service without a detected mapping', async () => {
    const row = serviceRow();
    row.service!.baseUrlEnv = null;
    row.service!.declaredInRecipe = false;
    row.service!.baseUrlEnvSource = null;
    row.fields = [];
    serve(row);
    render(page());
    await screen.findByText(/No base URL variable was detected/);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
