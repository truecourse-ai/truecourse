/**
 * Models settings page (enterprise). Pick the LLM provider TrueCourse uses for
 * spec scans, inference, verification, and analysis, and store its key
 * (encrypted server-side, never shown again). Lives behind the `llm-config`
 * capability. Saving runs a live provider test before persisting.
 */

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  LlmConfigResponse,
  LlmConfigUpdate,
  LlmProviderKind,
} from '@truecourse/shared';
import { getJson, patchJson } from './api';

const PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  anthropic: 'Anthropic API',
  openai: 'OpenAI',
  bedrock: 'AWS Bedrock',
  copilot: 'GitHub Copilot',
};

const MODEL_PLACEHOLDER: Record<LlmProviderKind, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
  bedrock: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
  copilot: 'gpt-4o',
};

const inputCls =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-neutral-300">{label}</span>
      {children}
    </label>
  );
}

export default function ModelsPage() {
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState<LlmProviderKind>('anthropic');
  const [model, setModel] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [region, setRegion] = useState('');

  const load = useCallback(() => {
    getJson<LlmConfigResponse>('/api/ee/llm/config')
      .then((d) => {
        setData(d);
        if (d.config) {
          setProvider(d.config.provider);
          setModel(d.config.model);
          setFallbackModel(d.config.fallbackModel ?? '');
          setAccessKeyId(d.config.accessKeyId ?? '');
          setBaseURL(d.config.baseURL ?? '');
          setRegion(d.config.region ?? '');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body: LlmConfigUpdate = {
      provider,
      model: model.trim(),
      fallbackModel: fallbackModel.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
      accessKeyId: accessKeyId.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
      region: region.trim() || undefined,
    };
    patchJson<{ config: LlmConfigResponse['config'] }>('/api/ee/llm/config', body)
      .then((r) => {
        setSaved(true);
        setApiKey('');
        setData((d) => (d ? { ...d, config: r.config } : d));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const current = data?.config ?? null;
  const isBedrock = provider === 'bedrock';
  const isCopilot = provider === 'copilot';
  const keyForThisProvider = current?.hasKey && current.provider === provider;
  const keyPlaceholder = keyForThisProvider
    ? `${current?.keyMask ?? '••••'} — leave blank to keep`
    : isBedrock
      ? 'AWS secret access key (or leave blank to use the IAM role)'
      : 'Paste the provider API key';

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Models</h1>
        <p className="text-sm text-neutral-400">
          The LLM provider TrueCourse uses for spec scans, inference,
          verification, and analysis. Keys are encrypted at rest and never shown
          again.
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Provider verified and saved.
        </div>
      )}
      {data?.envManaged && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          A provider is also configured via environment variables. Saving here
          overrides it for this process.
        </div>
      )}

      {current && (
        <section className="rounded border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm">
          <div className="text-neutral-400">Active provider</div>
          <div className="mt-1 font-medium">
            {PROVIDER_LABELS[current.provider]} —{' '}
            <span className="font-mono">{current.model}</span>
          </div>
          <div className="mt-1 text-neutral-500">
            {current.hasKey ? `Key ${current.keyMask}` : 'No stored key'} · updated{' '}
            {new Date(current.updatedAt).toLocaleString()}
          </div>
        </section>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProviderKind)}
            className={inputCls}
          >
            {(data?.providers ?? (['anthropic', 'openai', 'bedrock', 'copilot'] as LlmProviderKind[])).map(
              (p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ),
            )}
          </select>
        </Field>

        <Field label="Model">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={MODEL_PLACEHOLDER[provider]}
            className={inputCls}
            required
          />
        </Field>

        <Field label="Fallback model (optional)">
          <input
            value={fallbackModel}
            onChange={(e) => setFallbackModel(e.target.value)}
            placeholder="Tried only if the primary model errors"
            className={inputCls}
          />
        </Field>

        <Field label={isBedrock ? 'AWS secret access key' : 'API key'}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={keyPlaceholder}
            className={inputCls}
            autoComplete="off"
          />
        </Field>

        {isBedrock && (
          <>
            <Field label="AWS region">
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                className={inputCls}
              />
            </Field>
            <Field label="AWS access key id (optional)">
              <input
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
                placeholder="Leave blank to use the instance IAM role"
                className={inputCls}
              />
            </Field>
          </>
        )}

        {!isBedrock && (
          <Field label="Custom base URL (optional)">
            <input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={
                isCopilot
                  ? 'Defaults to the GitHub Copilot endpoint'
                  : 'For a gateway/proxy or self-hosted endpoint'
              }
              className={inputCls}
            />
          </Field>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>
    </div>
  );
}
