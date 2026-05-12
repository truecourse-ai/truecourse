import { useEffect, useRef, useState } from 'react';
export function SafeHook(): JSX.Element { return <div>Safe</div>; }
export function StableDep(): JSX.Element { return <div>Stable</div>; }
export function AccessibleTable(): JSX.Element {
  return (<table><thead><tr><th>Column</th></tr></thead><tbody><tr><td>Row</td></tr></tbody></table>);
}
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: string;
}
export function StyledButton({ variant, ...rest }: ButtonProps): JSX.Element {
  return <button className={variant} {...rest} />;
}
const EFFECT_TIMEOUT_MS = 10_000;
export function EffectWithFetch(): JSX.Element {
  useEffect(() => { fetch('/api/data', { signal: AbortSignal.timeout(EFFECT_TIMEOUT_MS) }).catch(() => undefined); }, []);
  return <div>loaded</div>;
}

// async-void-function: useEffect calling async function without await (standard React pattern)
export function AsyncEffectComponent(): JSX.Element {
  useEffect(() => { async function run(): Promise<void> { await fetch('/api/data'); } run().catch(() => undefined); }, []);
  return <div>loaded</div>;
}

// useeffect-missing-deps: useEffect using a ref (stable, no deps needed)
export function RefEffect(): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);
  return <div ref={ref}>focused</div>;
}

// Positive: async-void-function — onClick wrapper calling async function (not async itself)
const CLICK_TIMEOUT_MS = 5000;
async function handleClick(): Promise<void> {
  await fetch('/api/action', { signal: AbortSignal.timeout(CLICK_TIMEOUT_MS) });
}
export function AsyncButton(): JSX.Element {
  const onClick = (): void => { handleClick().catch(() => undefined); };
  return <button onClick={onClick}>Click</button>;
}

// Positive: react-unstable-key — static skeleton list (no dynamic key needed)
export function LoadingSkeleton(): JSX.Element {
  return <div><div>Loading 1...</div><div>Loading 2...</div><div>Loading 3...</div></div>;
}

// Positive: floating-promise — Promise.resolve in sync context (not a real floating promise)
export function SafePromise(): JSX.Element {
  return <div>safe</div>;
}

// Positive: react-unstable-key — covered by existing LoadingSkeleton fixture above

// useeffect-missing-deps: developer has explicitly suppressed the dependency
// rule via // eslint-disable-next-line on the line preceding the deps array.
// truecourse should respect this suppression and stay silent.
interface UserProfileProps { readonly userId: string; }
interface User { id: string; email: string; }
export function UserProfile({ userId }: UserProfileProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then((r) => r.json())
      .then((data: User) => setUser(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div data-user={user?.id}>{user?.email}</div>;
}



// useeffect-missing-deps shape-a1d14fb992d8: dynamic import of static ES module + stable state setter; no reactive values captured
interface FakerLike { readonly seed: (n: number) => void }
export function FakerLoader(): JSX.Element {
  const [fakerInstance, setFakerInstance] = useState<FakerLike | null>(null);
  useEffect(() => {
    void import('@faker-js/faker/locale/en').then((mod: { faker: FakerLike }) => {
      setFakerInstance(mod.faker);
    });
  }, []);
  return <div data-loaded={fakerInstance ? 'yes' : 'no'}>faker</div>;
}

// useeffect-missing-deps shape-bfb0d3bfb460: window message listener with cleanup; handler defined inside effect, only stable setter used
export function MessageLogger(): JSX.Element {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const timestamp = new Date().toISOString().slice(11, 19);
      setMessages((prev) => [...prev, `[${timestamp}] ${JSON.stringify(event.data)}`]);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  return <ul>{messages.map((m, i) => <li key={`${i}-${m.length}`}>{m}</li>)}</ul>;
}

// useeffect-missing-deps shape-5c9466c8ed76: mount-only auto-launch reading initial URL search params once; ref guard enforces single execution
declare const searchParams: { get: (key: string) => string | null };
declare function launchEmbed(token: string): Promise<void>;
export function AutoLaunchEmbed(): JSX.Element {
  const hasAutoLaunched = useRef<boolean>(false);
  useEffect(() => {
    if (hasAutoLaunched.current) {
      return;
    }
    const initialToken = searchParams.get('token');
    if (initialToken) {
      hasAutoLaunched.current = true;
      void launchEmbed(initialToken);
    }
  }, []);
  return <div>auto-launch</div>;
}



// Positive: deeply-nested-functions — React Hook Form render-prop callbacks
// inside Draggable/fieldset JSX. Each render arrow is only one level deep
// locally; the visual indentation is JSX nesting, not function nesting.
// The render={(...) => ...} arrow lives in a JSX attribute (not in a call
// argument list), so the current rule counts it as a real nesting level and
// fires when an inner event handler (e.g. onChange={(e) => ...}) is also a
// JSX attribute arrow. Standard react-hook-form + react-beautiful-dnd shape.
declare const Draggable: (props: {
  readonly draggableId: string;
  readonly index: number;
  readonly children: (provided: {
    readonly innerRef: (el: HTMLElement | null) => void;
    readonly draggableProps: Record<string, unknown>;
    readonly dragHandleProps: Record<string, unknown>;
  }) => JSX.Element;
}) => JSX.Element;

declare const FormField: <T>(props: {
  readonly control: unknown;
  readonly name: string;
  readonly render: (ctx: { readonly field: {
    readonly value: T;
    readonly onChange: (value: T) => void;
    readonly onBlur: () => void;
  } }) => JSX.Element;
}) => JSX.Element;

declare const FormItem: (props: { readonly children: React.ReactNode; readonly className?: string }) => JSX.Element;
declare const FormControl: (props: { readonly children: React.ReactNode }) => JSX.Element;
declare const FormLabel: (props: { readonly children: React.ReactNode; readonly className?: string }) => JSX.Element;
declare const FormMessage: () => JSX.Element;
declare const RecipientRoleSelect: (props: {
  readonly value: string;
  readonly onValueChange: (v: string) => void;
  readonly disabled?: boolean;
}) => JSX.Element;

interface SignerRowProps {
  readonly index: number;
  readonly signer: { readonly id: string; readonly disabled: boolean };
  readonly control: unknown;
  readonly isSubmitting: boolean;
  readonly handleSigningOrderChange: (index: number, value: string) => void;
}

export function SignerRow({
  index,
  signer,
  control,
  isSubmitting,
  handleSigningOrderChange,
}: SignerRowProps): JSX.Element {
  return (
    <Draggable draggableId={signer.id} index={index}>
      {(provided) => (
        <fieldset
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          disabled={signer.disabled}
        >
          <FormField
            control={control}
            name={`signers.${index}.signingOrder`}
            render={({ field }) => (
              <FormItem className="flex w-16 items-center gap-x-1">
                <FormControl>
                  <input
                    type="number"
                    value={String(field.value)}
                    disabled={isSubmitting}
                    onChange={(e) => {
                      field.onChange(e.target.value as unknown as never);
                    }}
                    onBlur={(e) => {
                      field.onBlur();
                      handleSigningOrderChange(index, e.target.value);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`signers.${index}.name`}
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Name</FormLabel>
                <FormControl>
                  <input
                    placeholder="Name"
                    value={String(field.value)}
                    disabled={isSubmitting}
                    onChange={(e) => field.onChange(e.target.value as unknown as never)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`signers.${index}.role`}
            render={({ field }) => (
              <FormItem className="flex-none">
                <FormLabel className="sr-only">Role</FormLabel>
                <FormControl>
                  <RecipientRoleSelect
                    value={String(field.value)}
                    onValueChange={field.onChange as unknown as (v: string) => void}
                    disabled={isSubmitting || signer.disabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>
      )}
    </Draggable>
  );
}



/**
 * conditional-cleanup-branch:
 *
 * `useEffect` looks up a DOM container by id and only attaches a 'blur'
 * listener when the element exists. The cleanup function that calls
 * `removeEventListener` is returned from inside the `if (container)`
 * branch — when `container` is null no listener is added and no cleanup
 * is needed. The rule misfires because its snippet captures only the
 * first two lines of the effect body (the `getElementById` lookup) and
 * does not see the conditional `return () => ...` that properly removes
 * the listener. Every code path that registers a side-effect also
 * unregisters it, so the effect is correctly cleaned up.
 */
export function ConditionalCleanupEffect(): JSX.Element {
  const handleAutoSave = (): void => {
    void fetch('/api/save', { method: 'POST' }).catch(() => undefined);
  };

  useEffect(() => {
    const container = window.document.getElementById('document-flow-form-container');

    const handleBlur = (): void => {
      handleAutoSave();
    };

    if (container) {
      container.addEventListener('blur', handleBlur, true);
      return () => {
        container.removeEventListener('blur', handleBlur, true);
      };
    }
    return undefined;
  }, []);

  return <div id="document-flow-form-container">form</div>;
}


/**
 * one-shot-beforeunload-listener:
 *
 * Registers a `beforeunload` handler that fires once when the user leaves the
 * page. The listener tears itself down at unload time, so a cleanup function
 * is technically unnecessary — but the missing-cleanup-useeffect rule still
 * flags the effect because there is no `return` at the top of the callback
 * body. This is the canonical FP shape for the rule.
 */
export function BeforeUnloadWarning(): JSX.Element {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
  }, []);

  return <div>Editing — leaving the page will prompt for confirmation.</div>;
}

