/**
 * The EXTERNAL APIs tab — the third parties this repo talks to, and the
 * account (real or sandbox) the user hands guard for each.
 *
 * The page is one card per service: what the analyzer DETECTED, what `recipe.json`
 * DECLARES, and how it resolves on THIS machine (provided / incomplete /
 * unprovided, with the per-requirement reasons the engine computed). Provided ⇒
 * the next generate authors live-integration flows against it and the runner points
 * the app at it; unprovided ⇒ its flows stay blocked, and the card says how many.
 *
 * A needs-setup CTA anywhere else in guard links here with `?gext=<service>`:
 * the page lands on that service's card with its account form already open, then
 * drops the param — the deep link is a one-shot jump, never a sticky selection.
 *
 * The edit form is the SECRECY split made visible: a declaration (service,
 * `baseUrlEnv`, which variables it needs, mode, description) is committed to
 * recipe.json so the team shares it; a pasted VALUE is a secret and goes to the
 * gitignored overlay. The page never renders a stored value back — a resolved
 * secret reads `•••• stored locally`, never its characters.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plug,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useGuardExternals } from '@/hooks/useGuardExternals';
import type {
  GuardExternalEnvPatch,
  GuardExternalPatch,
  GuardExternalServiceView,
  GuardExternalState,
  GuardExternalsView,
} from '@/types/guard-externals';

const LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground break-all';
const FIELD_LABEL = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Provided is the only good state; incomplete is the one that needs action. */
const STATE_TONE: Record<GuardExternalState, string> = {
  provided: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  incomplete: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  unprovided: 'border-border bg-muted text-muted-foreground',
};

const STATE_HINT: Record<GuardExternalState, string> = {
  provided: 'Flows run against this account.',
  incomplete: 'Half-configured — a guard run stops rather than call the wrong world.',
  unprovided: 'No account yet — flows that need it stay blocked.',
};

export interface GuardExternalsPaneProps {
  repoId: string;
  /** Bumped by the page on a guard completion (`spec:complete`) — a refetch signal. */
  reloadKey?: number;
}

/** The DOM anchor a `?gext=` deep link scrolls to — one per service card. */
function cardId(service: string): string {
  return `tc-ext-card-${service}`;
}

export function GuardExternalsPane({ repoId, reloadKey = 0 }: GuardExternalsPaneProps) {
  const { view, loading, error, save, saving } = useGuardExternals(repoId, true, reloadKey);
  // Which card's form is open — at most one, and `__new__` for the manual add.
  const [editing, setEditing] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const requested = params.get('gext');
  const scrollTo = useRef<string | null>(null);

  // A needs-setup CTA elsewhere in guard named ONE service and sent the user here
  // to provide it. Land ON that card with its account form already open
  // — the next action is pasting the key, not hunting the list — and CONSUME the
  // param, so a later manual visit to the tab is a plain read of the page.
  useEffect(() => {
    if (!requested || !view) return;
    if (view.services.some((s) => s.service === requested)) {
      setFormError(null);
      setEditing(requested);
      scrollTo.current = requested;
    }
    setParams(
      (prev) => {
        const q = new URLSearchParams(prev);
        q.delete('gext');
        return q;
      },
      { replace: true },
    );
  }, [requested, view, setParams]);

  // After the card has rendered its form — otherwise the scroll lands on the row's
  // pre-form height and the form opens off-screen.
  useEffect(() => {
    const service = scrollTo.current;
    if (!service || editing !== service) return;
    scrollTo.current = null;
    document.getElementById(cardId(service))?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [editing]);

  const onSave = async (service: string, patch: GuardExternalPatch | null): Promise<void> => {
    const message = await save(service, patch);
    setFormError(message);
    if (message === null) setEditing(null);
  };

  if (loading && !view) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !view) {
    return (
      <EmptyState
        icon={Plug}
        title="External API accounts unavailable"
        body={error ?? 'The externals view could not be read.'}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <Header view={view} />
      <div className="space-y-3 px-4 pb-8">
        <Warnings view={view} />

        {view.services.length === 0 && editing !== '__new__' && (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center">
            <Plug className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              No external services {view.detectionAvailable ? 'found' : 'known yet'}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {view.detectionAvailable
                ? 'The last generate saw no third-party API in this repo. Declare one by hand if TrueCourse cannot see it (a service reached through your own wrapper, say).'
                : 'Detection has not run — this is not a claim that the repo has none. Run `truecourse guard generate` to detect the third parties it imports, or declare one by hand.'}
            </p>
          </div>
        )}

        {view.services.map((service) => (
          <ServiceCard
            key={service.service}
            service={service}
            editing={editing === service.service}
            onEdit={() => {
              setFormError(null);
              setEditing(editing === service.service ? null : service.service);
            }}
            onCancel={() => setEditing(null)}
            onSave={onSave}
            saving={saving}
            error={editing === service.service ? formError : null}
          />
        ))}

        {editing === '__new__' ? (
          <div className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Declare a service</span>
            </div>
            <ExternalForm
              service={null}
              existingNames={view.services.map((s) => s.service)}
              onCancel={() => setEditing(null)}
              onSave={onSave}
              saving={saving}
              error={formError}
            />
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFormError(null);
              setEditing('__new__');
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add service
          </Button>
        )}
      </div>
    </div>
  );
}

/** The one-sentence what-this-is, plus the two files the page writes. */
function Header({ view }: { view: GuardExternalsView }) {
  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">External APIs</h2>
      </div>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
        The third parties this app calls. Hand guard a real or sandbox account for one and its
        flows are tested against the live service; leave it unprovided and they stay blocked.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>
          Declarations → <code className="font-mono">{view.recipePath}</code> (committed)
        </span>
        <span>·</span>
        <span>
          Secrets → <code className="font-mono">{view.localPath}</code> (gitignored)
        </span>
      </div>
    </div>
  );
}

/** Everything the page must say before the cards: broken files, no detection, orphan overlay entries. */
function Warnings({ view }: { view: GuardExternalsView }) {
  const strips: { key: string; text: string }[] = [];
  if (view.invalidReason) strips.push({ key: 'invalid', text: view.invalidReason });
  if (!view.hasApiBlock) {
    strips.push({
      key: 'no-api',
      text: view.recipeValid
        ? 'recipe.json has no `api` block — external services configure the api driver, so the recipe needs one before an account can be saved.'
        : 'No usable recipe.json yet — run `truecourse guard recipe --init` before declaring external services.',
    });
  }
  if (!view.detectionAvailable) {
    strips.push({
      key: 'no-detection',
      text: 'No generate report yet, so detection has not run: only declared services are listed. Run `truecourse guard generate` to detect the third parties this repo imports.',
    });
  }
  if (view.unknownLocalServices.length > 0) {
    strips.push({
      key: 'unknown-local',
      text: `The local overlay carries entries the recipe never declares, so they are ignored: ${view.unknownLocalServices.join(', ')}. Declare the service here to make them count.`,
    });
  }
  if (strips.length === 0) return null;
  return (
    <div className="space-y-2 pt-3">
      {strips.map((s) => (
        <div
          key={s.key}
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  );
}

interface ServiceCardProps {
  service: GuardExternalServiceView;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (service: string, patch: GuardExternalPatch | null) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function ServiceCard({ service, editing, onEdit, onCancel, onSave, saving, error }: ServiceCardProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const unresolved = service.requirements.filter((r) => !r.resolved);

  return (
    <div id={cardId(service.service)} className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{service.service}</span>
        {service.category && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {service.category}
          </span>
        )}
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATE_TONE[service.state]}`}
          title={STATE_HINT[service.state]}
        >
          {service.state}
        </span>
        {service.blockedFlows > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {service.blockedFlows} blocked test{service.blockedFlows === 1 ? '' : 's'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {service.declared && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void onSave(service.service, null)}
              title="Remove this declaration from recipe.json (and its stored values)"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            {editing ? 'Close' : service.declared ? 'Edit account' : 'Provide account'}
          </Button>
        </div>
      </div>

      {service.description && (
        <p className="mt-1.5 text-xs text-muted-foreground">{service.description}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {service.baseUrlEnv && (
          <span>
            <span className={LABEL}>base url env </span>
            <code className={CODE}>{service.baseUrlEnv}</code>
            {service.baseUrlEnvSource === 'detected' && (
              <span className="ml-1 text-[10px]">(seen in the source — a suggestion)</span>
            )}
          </span>
        )}
        {(service.baseUrlEnvs ?? []).length > 1 && (
          <span title="This service is reached through more than one host — each has its own variable.">
            <span className={LABEL}>also </span>
            <code className={CODE}>
              {(service.baseUrlEnvs ?? [])
                .slice(1)
                .map((e) => e.envVar)
                .join(', ')}
            </code>
          </span>
        )}
        {service.baseUrl && (
          <span>
            <span className={LABEL}>base url </span>
            <code className={CODE}>{service.baseUrl}</code>
          </span>
        )}
        {Object.entries(service.endpoints ?? {}).map(([envVar, url]) => (
          <span key={envVar} title="Another host of this service — the runner proxies it too.">
            <span className={LABEL}>{envVar} </span>
            <code className={CODE}>{url}</code>
          </span>
        ))}
        {service.mode && <span className="uppercase">{service.mode}</span>}
      </div>

      {!service.declared && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Detected but not declared in recipe.json — nothing is configured for it yet.
        </p>
      )}
      {service.declared && !service.detected && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Declared by hand — the last detection run did not see this service in the code.
        </p>
      )}

      {unresolved.length > 0 && service.declared && (
        <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 p-2">
          <div className={LABEL}>Still needed</div>
          <ul className="mt-1 space-y-0.5">
            {unresolved.map((r) => (
              <li key={`${r.kind}:${r.envVar}`} className="text-[11px] text-amber-700 dark:text-amber-300">
                <code className="font-mono">{r.envVar}</code> — {r.reason ?? 'unresolved'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {service.requirements.some((r) => r.resolved && r.secret) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {service.requirements
            .filter((r) => r.resolved && r.secret)
            .map((r) => (
              <span key={r.envVar} className={CODE}>
                {r.envVar}=•••• {r.source === 'local' ? 'stored locally' : r.source === 'process-env' ? 'from your shell env' : 'inline in the recipe'}
              </span>
            ))}
        </div>
      )}

      {service.undeclaredLocalEnv.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
          Local overlay keys the recipe never declares (ignored): {service.undeclaredLocalEnv.join(', ')}
        </p>
      )}

      {service.evidence.length > 0 && (
        <div className="mt-2">
          <button
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowEvidence((v) => !v)}
          >
            {showEvidence ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Detection evidence ({service.evidence.length})
          </button>
          {showEvidence && (
            <ul className="mt-1 space-y-0.5">
              {service.evidence.map((e) => (
                <li
                  key={`${e.filePath}:${e.importSource ?? e.url ?? ''}`}
                  className="text-[11px] text-muted-foreground"
                >
                  <code className="font-mono">{e.filePath}</code>{' '}
                  {e.importSource ? 'imports' : 'requests'}{' '}
                  <code className="font-mono">{e.importSource ?? e.url}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 border-t border-border pt-3">
          <ExternalForm
            service={service}
            existingNames={[]}
            onCancel={onCancel}
            onSave={onSave}
            saving={saving}
            error={error}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The edit form.
// ---------------------------------------------------------------------------

/** Where one env var's value comes from — the three storage answers, in plain words. */
type EnvSource = 'secret' | 'from-env' | 'inline';

/** One EXTRA base-URL variable of the service — an origin, always committed. */
interface EndpointRow {
  key: number;
  name: string;
  url: string;
  /** Already declared: the row edits it in place, and removal drops the declaration. */
  existing: boolean;
  removed: boolean;
}

interface EnvRow {
  key: number;
  name: string;
  source: EnvSource;
  value: string;
  /** Already declared: it keeps its stored value unless this row supplies a new one. */
  existing: boolean;
  /** Already resolved on this machine — shown masked, never echoed. */
  stored: boolean;
  storedFrom?: 'recipe' | 'local' | 'process-env';
  removed: boolean;
}

const ENV_SOURCE_HINT: Record<EnvSource, string> = {
  secret: 'Stored in the gitignored externals.local.json — never committed.',
  'from-env': 'The recipe commits the NAME of a variable read from your shell env.',
  inline: 'Written into the committed recipe.json — non-secret values only.',
};

interface ExternalFormProps {
  /** The service being edited, or null for a manual declaration. */
  service: GuardExternalServiceView | null;
  /** Names already on the page — a manual add must not collide with one. */
  existingNames: string[];
  onCancel: () => void;
  onSave: (service: string, patch: GuardExternalPatch | null) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function ExternalForm({ service, existingNames, onCancel, onSave, saving, error }: ExternalFormProps) {
  const [name, setName] = useState(service?.service ?? '');
  const [baseUrlEnv, setBaseUrlEnv] = useState(service?.baseUrlEnv ?? '');
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl ?? '');
  const [mode, setMode] = useState<'' | 'sandbox' | 'real'>(service?.mode ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [rows, setRows] = useState<EnvRow[]>(() => initialEnvRows(service));
  const [endpointRows, setEndpointRows] = useState<EndpointRow[]>(() => initialEndpointRows(service));
  const [nextKey, setNextKey] = useState(1000);
  const [localError, setLocalError] = useState<string | null>(null);

  const collision = useMemo(
    () => existingNames.includes(name.trim()) && service === null,
    [existingNames, name, service],
  );

  const submit = async () => {
    const serviceName = name.trim();
    if (!serviceName) return setLocalError('Name the service — it is the recipe key.');
    if (collision) return setLocalError(`"${serviceName}" is already on this page — edit its card instead.`);
    if (!baseUrlEnv.trim()) {
      return setLocalError('The base-URL env var is required: it is the variable your app reads the origin from.');
    }
    const env: Record<string, GuardExternalEnvPatch> = {};
    for (const row of rows) {
      const varName = row.name.trim();
      if (!varName) continue;
      if (row.removed) {
        env[varName] = null;
        continue;
      }
      const value = row.value.trim();
      // An existing row with no new value keeps whatever it already has — the engine
      // preserves env vars a patch does not mention.
      if (value === '') {
        if (!row.existing) {
          return setLocalError(`Give ${varName} a value, or remove the row.`);
        }
        continue;
      }
      env[varName] =
        row.source === 'from-env'
          ? { valueFromEnv: value }
          : row.source === 'inline'
            ? { value, inline: true }
            : { value };
    }
    const endpoints: Record<string, string | null> = {};
    for (const row of endpointRows) {
      const varName = row.name.trim();
      if (!varName) continue;
      if (row.removed) {
        endpoints[varName] = null;
        continue;
      }
      const url = row.url.trim();
      if (!/^https?:\/\/\S+$/.test(url)) {
        return setLocalError(`Give ${varName} an absolute http(s) URL, or remove the row.`);
      }
      endpoints[varName] = url;
    }
    setLocalError(null);
    await onSave(serviceName, {
      baseUrlEnv: baseUrlEnv.trim(),
      ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      ...(Object.keys(endpoints).length > 0 ? { endpoints } : {}),
      ...(mode ? { mode } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });
  };

  return (
    <div className="space-y-3">
      {service === null && (
        <div>
          <label className={FIELD_LABEL} htmlFor="tc-ext-name">
            Service
          </label>
          <Input
            id="tc-ext-name"
            value={name}
            placeholder="stripe"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={FIELD_LABEL} htmlFor={`tc-ext-urlenv-${name}`}>
            Base URL env var
          </label>
          <Input
            id={`tc-ext-urlenv-${name}`}
            value={baseUrlEnv}
            placeholder="STRIPE_BASE_URL"
            onChange={(e) => setBaseUrlEnv(e.target.value)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {service?.baseUrlEnvSource === 'detected'
              ? 'Pre-filled from the code — TrueCourse saw the app read this variable.'
              : 'The variable your app reads this service’s origin from.'}
          </p>
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor={`tc-ext-url-${name}`}>
            Base URL
          </label>
          <Input
            id={`tc-ext-url-${name}`}
            value={baseUrl}
            placeholder="https://api.sandbox.example.com"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Committed to recipe.json — an origin is not a secret.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className={FIELD_LABEL}>Account kind</span>
          <div className="flex gap-1">
            {(['sandbox', 'real'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(mode === m ? '' : m)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  mode === m
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor={`tc-ext-desc-${name}`}>
            Description
          </label>
          <Input
            id={`tc-ext-desc-${name}`}
            value={description}
            placeholder="test-mode account, no live charges"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div>
        <span className={FIELD_LABEL}>Other base URLs of this service</span>
        <div className="space-y-2">
          {endpointRows.filter((r) => !r.removed).length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              None — this service is reached through one host.
            </p>
          )}
          {endpointRows.map((row) =>
            row.removed ? null : (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-[220px]"
                  value={row.name}
                  placeholder="GEOCODING_BASE_URL"
                  aria-label="Endpoint env var"
                  disabled={row.existing}
                  onChange={(e) =>
                    setEndpointRows((rs) =>
                      rs.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)),
                    )
                  }
                />
                <Input
                  className="max-w-[300px]"
                  value={row.url}
                  placeholder="https://geocoding.example.com"
                  aria-label={`URL for ${row.name || 'endpoint'}`}
                  onChange={(e) =>
                    setEndpointRows((rs) =>
                      rs.map((r) => (r.key === row.key ? { ...r, url: e.target.value } : r)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    setEndpointRows((rs) =>
                      row.existing
                        ? rs.map((r) => (r.key === row.key ? { ...r, removed: true } : r))
                        : rs.filter((r) => r.key !== row.key),
                    )
                  }
                  aria-label={`Remove ${row.name || 'endpoint'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ),
          )}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Committed to recipe.json. A vendor reached through several hosts needs one row per
          host — the runner proxies every one of them, so a scenario can script faults on the
          whole service.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => {
            setEndpointRows((rs) => [
              ...rs,
              { key: nextKey, name: '', url: '', existing: false, removed: false },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add base URL
        </Button>
      </div>

      <div>
        <span className={FIELD_LABEL}>Env vars the app needs</span>
        <div className="space-y-2">
          {rows.filter((r) => !r.removed).length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              None — this service needs only its base URL.
            </p>
          )}
          {rows.map((row) =>
            row.removed ? null : (
              <div key={row.key} className="rounded border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-[220px]"
                    value={row.name}
                    placeholder="STRIPE_API_KEY"
                    aria-label="Env var name"
                    disabled={row.existing}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))
                    }
                  />
                  <div className="flex gap-1">
                    {(['secret', 'from-env', 'inline'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={row.source === s}
                        title={ENV_SOURCE_HINT[s]}
                        onClick={() =>
                          setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, source: s } : r)))
                        }
                        className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                          row.source === s
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {s === 'secret' ? 'paste secret' : s === 'from-env' ? 'from shell env' : 'inline'}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() =>
                      setRows((rs) =>
                        row.existing
                          ? rs.map((r) => (r.key === row.key ? { ...r, removed: true } : r))
                          : rs.filter((r) => r.key !== row.key),
                      )
                    }
                    aria-label={`Remove ${row.name || 'env var'}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Input
                  className="mt-2"
                  type={row.source === 'secret' ? 'password' : 'text'}
                  value={row.value}
                  aria-label={`Value for ${row.name || 'env var'}`}
                  placeholder={
                    row.source === 'from-env'
                      ? 'MY_STRIPE_KEY (the shell variable to read)'
                      : row.stored
                        ? `•••• ${storedWhere(row.storedFrom)} — type to replace`
                        : row.source === 'inline'
                          ? 'a non-secret value, committed as written'
                          : 'paste the key — it goes to the gitignored overlay'
                  }
                  onChange={(e) =>
                    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, value: e.target.value } : r)))
                  }
                />
                <p className="mt-1 text-[10px] text-muted-foreground">{ENV_SOURCE_HINT[row.source]}</p>
              </div>
            ),
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => {
            setRows((rs) => [
              ...rs,
              { key: nextKey, name: '', source: 'secret', value: '', existing: false, stored: false, removed: false },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add env var
        </Button>
      </div>

      {(localError || error) && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {localError ?? error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving} onClick={() => void submit()}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The declared env vars as editable rows — values never come back, so none of THOSE
 * is pre-filled. Extra base-URL variables are NOT here: they are origins, and get
 * their own rows (see {@link initialEndpointRows}).
 */
function initialEnvRows(service: GuardExternalServiceView | null): EnvRow[] {
  if (!service) return [];
  return service.requirements
    .filter((r) => r.kind === 'env')
    .map((r, i) => ({
      key: i,
      name: r.envVar,
      source: r.source === 'process-env' ? ('from-env' as const) : ('secret' as const),
      value: '',
      existing: true,
      stored: r.resolved,
      ...(r.source ? { storedFrom: r.source } : {}),
      removed: false,
    }));
}

/**
 * The EXTRA base-URL rows: what the declaration already carries, plus — for a service
 * not yet declared — a SUGGESTED row per additional variable detection found,
 * pre-filled with the URL the app falls back to today. A vendor reached through
 * two hosts needs both pointed at the account, and the first one is already the
 * form's `baseUrlEnv` field.
 */
function initialEndpointRows(service: GuardExternalServiceView | null): EndpointRow[] {
  if (!service) return [];
  const declared = Object.entries(service.endpoints ?? {}).map(([name, url], i) => ({
    key: 300 + i,
    name,
    url,
    existing: true,
    removed: false,
  }));
  if (service.declared) return declared;

  const taken = new Set([service.baseUrlEnv, ...declared.map((r) => r.name)]);
  return [
    ...declared,
    ...(service.baseUrlEnvs ?? [])
      .filter((e) => !taken.has(e.envVar))
      .map((e, i) => ({
        key: 500 + i,
        name: e.envVar,
        url: e.defaultUrl ?? '',
        existing: false,
        removed: false,
      })),
  ];
}

function storedWhere(source: EnvRow['storedFrom']): string {
  if (source === 'local') return 'stored locally';
  if (source === 'process-env') return 'read from your shell env';
  if (source === 'recipe') return 'inline in the recipe';
  return 'stored';
}
