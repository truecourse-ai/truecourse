/**
 * ONE dependency, read in the order a reader asks about it:
 *
 *   WHAT IT MUST BE   the rolled-up requirement, then every flow that contributed
 *                     a part of it, an expectation is never anonymous, and the
 *                     flow that wants it is one click away.
 *   WHEN IT APPLIES   the condition sentence, or the honest "always".
 *   WHAT IT BLOCKS    the flows held back right now: committed tests that cannot
 *                     run, and the ones the last generate never wrote for want of
 *                     an instance.
 *   REGISTERING IT    the form, one input per declared variable, a path, or a config
 *                     directory. A service URL uses its variable name as the label;
 *                     credentials come from the variables the application reads.
 *
 * Detection evidence closes the page for a service (collapsed, it answers "why
 * do you think I depend on this", which is asked once).
 *
 * What is REGISTERED shows: a field the server sent a value for is filled in with
 * it, so a provided dependency never reads like an empty one. A SECRET is the
 * exception in exactly one way, the server sends a mask of it, and a mask goes in
 * the placeholder, never in the input: an input holds what a user typed, and nothing
 * that was never typed may be saved back. That is also why a blank secret field
 * means UNCHANGED and never "clear it", clearing is what blanking a value the page
 * can actually show (a host path or URL) looks like.
 *
 * The header carries the same two-mode switch every artifact-backed entity has:
 * this page, or the catalog's own committed entry. The gitignored overlay has no
 * raw reading and never will.
 */

import { useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Loader2, FlaskConical } from 'lucide-react';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/preview/ui/artifact-view';
import { Button } from '@/components/ui/button';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { Input } from '@/components/ui/input';
import { useGuardArtifactRaw } from '@/preview/vendor/hooks/useGuardArtifactRaw';
import { GUARD_DEPENDENCY_STATE, guardDependencyType } from '@/preview/vendor/lib/guard-dependencies';
import type {
  GuardDependencyField,
  GuardDependencyPatch,
  GuardDependencyRow,
} from '@/preview/vendor/types/guard-dependencies';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';
const STATUS = 'inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground';
const DOT = 'h-2 w-2 shrink-0 rounded-full';
const FIELD_LABEL = 'mb-1 block text-[11px] font-medium text-foreground';
const REF_BTN =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';

/** What a stored SECRET says instead of its value, wherever one is registered. */
const STORED_SECRET = '•••• stored locally';

/**
 * Placeholders are SAMPLE VALUES, never explanations, explanations live in the
 * label and the line under the input. Samples are inferred from the variable
 * name; an unrecognized name gets no placeholder at all.
 */
function sampleFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('provider')) return 'anthropic';
  if (n.includes('model')) return 'claude-opus-5';
  if (n.includes('key') || n.includes('token') || n.includes('secret')) return '';
  if (n.includes('url') || n.includes('base')) return '';
  if (n.includes('host') || n.includes('path') || n.includes('dir')) return '/usr/local/bin/tool';
  return '';
}

/**
 * The path this dependency is registered with, whether or not the machine still has
 * it: an unresolvable path is what somebody typed, and showing it is how the typo
 * gets corrected. `hostPath` is the resolved absolute one, kept as the fallback.
 */
function registeredPath(dependency: GuardDependencyRow): string {
  return dependency.fields.find((f) => f.field === 'path')?.value ?? dependency.hostPath ?? '';
}

/**
 * What the input SHOWS before anyone types: the registered value, and NEVER a
 * secret's, the server masks a stored secret, and a mask that sat in an input could
 * be saved back over the real one.
 */
function shownValue(field: GuardDependencyField | undefined): string {
  return field && !field.secret ? field.value ?? '' : '';
}

/**
 * What an EMPTY field says: the server's mask for a stored secret (there is
 * something here, and this is all of it a reader gets), otherwise a sample to type
 * over. A field showing its own value never reads its placeholder at all.
 */
function placeholderFor(field: GuardDependencyField | undefined, name: string): string {
  if (field?.secret && field.resolved) return field.value ?? STORED_SECRET;
  if (field?.resolved && field.value === undefined) return 'registered';
  return sampleFor(name);
}

export function GuardDependencyDetail({
  repoId,
  dependency,
  saving,
  onSave,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the catalog entry out of. */
  repoId: string;
  dependency: GuardDependencyRow;
  saving: boolean;
  /** Register this dependency's instance; resolves to an error message, or null. */
  onSave: (patch: GuardDependencyPatch) => Promise<string | null>;
  /** Jump into the Tests tab with one flow's detail open. */
  onOpenFlow?: (flowId: string) => void;
}) {
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const rawSource = useGuardArtifactRaw(repoId, 'dependency', dependency.name, raw && dependency.inCatalog);
  const [showEvidence, setShowEvidence] = useState(false);
  const type = guardDependencyType(dependency);
  const state = dependency.state ? GUARD_DEPENDENCY_STATE[dependency.state] : null;
  const evidence = dependency.service?.evidence ?? [];
  const multiService = (dependency.service?.services.length ?? 0) > 1;

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {type && (
            <HoverPopover portal width="wide" content={type.hint}>
              <span className={`${CHIP} bg-muted text-foreground`}>{type.label}</span>
            </HoverPopover>
          )}
          {state && (
            <HoverPopover portal width="narrow" content={state.hint}>
              <span className={STATUS}>
                <span aria-hidden className={`${DOT} ${state.dot}`} />
                {state.label}
              </span>
            </HoverPopover>
          )}
          {dependency.inCatalog && (
            <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="ml-auto" />
          )}
        </div>
        <h2 className="mt-1 break-words text-sm font-semibold text-foreground">{dependency.name}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{dependency.summary}</p>
      </div>

      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        {raw && dependency.inCatalog ? (
          <ArtifactRaw content={rawSource.content} label="dependency source" />
        ) : (
          <>
            {/* The form first: what the user must enter, then Save. Everything
                informational reads below it. */}
            <RegistrationForm dependency={dependency} saving={saving} onSave={onSave} />

            <div>
              <div className={LABEL}>What it must provide</div>
              <p className="text-[13px] leading-relaxed text-foreground">{dependency.requirement}</p>
              {dependency.needs.length > 0 && (
                <div className="mt-2 flex flex-col items-start gap-1">
                  {dependency.needs.map((need) => (
                    <button
                      key={`${need.flowId}-${need.need}`}
                      type="button"
                      disabled={!onOpenFlow}
                      onClick={() => onOpenFlow?.(need.flowId)}
                      className={REF_BTN}
                    >
                      <FlaskConical className="h-3 w-3 shrink-0" />
                      <span className="truncate">{need.title ?? need.flowId}</span>
                      <span className="min-w-0 truncate text-muted-foreground">· {need.need}</span>
                      {onOpenFlow && <ArrowUpRight className="h-3 w-3 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className={LABEL}>When it applies</div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {dependency.when ?? 'Always, every flow that binds it needs it.'}
              </p>
            </div>

            <div>
              <div className={LABEL}>What it blocks</div>
              {dependency.blocks.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  Nothing right now, no flow is waiting on it.
                </p>
              ) : (
                <div className="flex flex-col items-start gap-1">
                  {dependency.blocks.map((blocked) => (
                    <button
                      key={blocked.flowId ?? blocked.title}
                      type="button"
                      disabled={!blocked.flowId || !onOpenFlow}
                      onClick={() => blocked.flowId && onOpenFlow?.(blocked.flowId)}
                      className={REF_BTN}
                    >
                      <FlaskConical className="h-3 w-3 shrink-0" />
                      <span className="truncate">{blocked.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {blocked.kind === 'test-blocked' ? 'test cannot run' : 'no test written'}
                      </span>
                      {blocked.flowId && onOpenFlow && <ArrowUpRight className="h-3 w-3 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {evidence.length > 0 && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  aria-expanded={showEvidence}
                  onClick={() => setShowEvidence((v) => !v)}
                >
                  {showEvidence ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Detected in code ({evidence.length})
                </button>
                {showEvidence && (
                  <ul className="mt-1 space-y-0.5">
                    {evidence.map((e) => (
                      <li
                        key={`${e.service}:${e.filePath}:${e.importSource ?? e.url ?? ''}`}
                        className="break-words text-[11px] text-muted-foreground"
                      >
                        {/* Which third party the hit is for, said only when this row
                            stands for more than one, where the file alone is
                            ambiguous. */}
                        {multiService && (
                          <span className="mr-1 font-medium text-foreground">{e.service}</span>
                        )}
                        <code className="font-mono">{e.filePath}</code>{' '}
                        {e.importSource ? 'imports' : '→'}{' '}
                        <code className="font-mono">{e.importSource ?? e.url}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The registration form, rendered BY the registration's shape.
// ---------------------------------------------------------------------------

function RegistrationForm({
  dependency,
  saving,
  onSave,
}: {
  dependency: GuardDependencyRow;
  saving: boolean;
  onSave: (patch: GuardDependencyPatch) => Promise<string | null>;
}) {
  const registration = dependency.registration;
  const service = dependency.service;
  const [env, setEnv] = useState<Record<string, string>>({});
  const [pathValue, setPathValue] = useState(registeredPath(dependency));
  const baseUrlEnv = service?.baseUrlEnv ?? '';
  const [baseUrl, setBaseUrl] = useState<string>();
  const registeredUrl = registration?.kind === 'env' &&
    registration.vars.some((variable) => variable.name === baseUrlEnv);
  const showServiceUrl = service && baseUrlEnv && !registeredUrl &&
    (!registration || service.declaredInRecipe);
  const [error, setError] = useState<string | null>(null);

  // Nothing to register: the scenario creates this state, or the runner seeds it.
  if (!registration && !service) {
    return (
      <div>
        <div className={LABEL}>Registering it</div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {dependency.obtain ??
            (dependency.class === 'step-creatable'
              ? 'Nothing to register, a scenario creates this state with its own steps.'
              : 'Nothing to register, the runner materializes this state before the steps run.')}
        </p>
      </div>
    );
  }

  if (!registration && !baseUrlEnv) {
    return (
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        No base URL variable was detected for this service. Configure one in the application and run setup again.
      </p>
    );
  }

  const fieldOf = (name: string): GuardDependencyField | undefined =>
    dependency.fields.find((f) => f.field === name);

  const submit = async (): Promise<void> => {
    const patch: GuardDependencyPatch = {};
    if (registration?.kind === 'env') {
      const values: Record<string, string | null> = {};
      for (const [name, value] of Object.entries(env)) values[name] = value.trim() === '' ? null : value;
      if (Object.keys(values).length > 0) patch.env = values;
    } else if (registration) {
      patch.path = pathValue.trim() === '' ? null : pathValue.trim();
    } else {
      // A service the catalog does not declare: its own declaration fields, plus
      // whatever variables the recipe already names for it.
      patch.baseUrlEnv = baseUrlEnv;
      const values: Record<string, string | null> = {};
      for (const [name, value] of Object.entries(env)) {
        if (value.trim() === '') continue;
        values[name] = value;
      }
      if (Object.keys(values).length > 0) patch.env = values;
    }
    if (showServiceUrl && baseUrl !== undefined) patch.baseUrl = baseUrl.trim();
    if (Object.keys(patch).length === 0) {
      setError('Nothing to save, fill in a field first.');
      return;
    }
    const failure = await onSave(patch);
    setError(failure);
    if (failure) return;
    // A saved write leaves nothing typed behind: the fresh view is what the fields
    // read from now, and a secret must not sit in the DOM after it is stored.
    if (registration?.kind === 'env' || !registration) setEnv({});
    setBaseUrl(undefined);
  };

  return (
    <div>
      <div className={LABEL}>Registering it</div>
      <div className="space-y-3">
        {/* An instance IS stored, in the shape this entry used to be registered in.
            The form below is the current shape; this says why the old value is not
            filling it in, quietly, because nothing is broken. */}
        {dependency.staleInstance && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {dependency.staleInstance}.
          </p>
        )}
        {registration?.kind === 'env' &&
          registration.vars.map((variable) => {
            const field = fieldOf(variable.name);
            return (
              <div key={variable.name}>
                <label className={FIELD_LABEL} htmlFor={`tc-dep-${dependency.name}-${variable.name}`}>
                  {variable.name}
                  {/* An optional variable says so where the reader decides whether to
                      fill it in, a blank one is a legitimate answer, not a gap. */}
                  {variable.optional && (
                    <span className="ml-1.5 font-normal text-muted-foreground">optional</span>
                  )}
                </label>
                <Input
                  id={`tc-dep-${dependency.name}-${variable.name}`}
                  type={variable.secret ? 'password' : 'text'}
                  aria-label={variable.name}
                  value={env[variable.name] ?? shownValue(field)}
                  placeholder={placeholderFor(field, variable.name)}
                  onChange={(e) => setEnv((v) => ({ ...v, [variable.name]: e.target.value }))}
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {variable.description}
                  {field && !field.resolved && field.reason ? `, ${field.reason}` : ''}
                </p>
              </div>
            );
          })}

        {registration && registration.kind !== 'env' && (
          <div>
            <label className={FIELD_LABEL} htmlFor={`tc-dep-${dependency.name}-path`}>
              {registration.kind === 'config-dir' ? 'Directory' : 'Path'}
            </label>
            <Input
              id={`tc-dep-${dependency.name}-path`}
              aria-label={registration.kind === 'config-dir' ? 'Directory' : 'Path'}
              value={pathValue}
              placeholder={
                registration.kind === 'config-dir'
                  ? '/Users/you/.claude'
                  : '/Users/you/code/some-project'
              }
              onChange={(e) => setPathValue(e.target.value)}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {registration.description}
              {registration.kind === 'config-dir'
                ? ` Copied into the sandbox HOME at ${registration.homePath}.`
                : ' Copied into the sandbox, never used in place.'}
              {fieldOf('path')?.resolved === false && fieldOf('path')?.reason
                ? `, ${fieldOf('path')!.reason}`
                : ''}
            </p>
          </div>
        )}

        {showServiceUrl && (
          <div>
            <label className={FIELD_LABEL} htmlFor={`tc-dep-${dependency.name}-url`}>
              {baseUrlEnv}
            </label>
            <Input
              id={`tc-dep-${dependency.name}-url`}
              aria-label={baseUrlEnv}
              value={baseUrl ?? service.baseUrl ?? ''}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}
        {service && !registration &&
          dependency.fields
            .filter((field) => field.field !== baseUrlEnv)
            .map((field) => (
              <div key={field.field}>
                <label className={FIELD_LABEL} htmlFor={`tc-dep-${dependency.name}-${field.field}`}>
                  {field.field}
                </label>
                <Input
                  id={`tc-dep-${dependency.name}-${field.field}`}
                  type={field.secret ? 'password' : 'text'}
                  aria-label={field.field}
                  value={env[field.field] ?? shownValue(field)}
                  placeholder={placeholderFor(field, field.field)}
                  onChange={(e) => setEnv((v) => ({ ...v, [field.field]: e.target.value }))}
                />
              </div>
            ))}

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <Button size="sm" disabled={saving} onClick={() => void submit()}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
