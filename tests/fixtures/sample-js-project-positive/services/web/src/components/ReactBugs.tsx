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



// argument-type-mismatch: .map() in JSX with correctly typed callback parameter
interface TeamMember {
  id: string;
  name: string;
  role: string;
}

declare const teamMembers: TeamMember[];

export function TeamMemberList(): JSX.Element {
  return (
    <ul className="team-list">
      {teamMembers.map((member) => (
        <li key={member.id}>
          <div className="member-card">
            <span className="member-name">{member.name}</span>
            <span className="member-role">{member.role}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}



// argument-type-mismatch: Object.values returns correctly typed array, map is valid
declare const THEME_OPTIONS: {
  light: { id: string; label: string };
  dark: { id: string; label: string };
  auto: { id: string; label: string };
};

interface MenuItemProps {
  key: string;
  label: string;
  onSelect: () => void;
}

declare function MenuItem(props: MenuItemProps): JSX.Element;

export function ThemeSelector(): JSX.Element {
  return (
    <div>
      {Object.values(THEME_OPTIONS).map((theme) => (
        <MenuItem
          key={theme.id}
          label={theme.label}
          onSelect={() => console.log(theme.id)}
        />
      ))}
    </div>
  );
}



// argument-type-mismatch: React.forwardRef with correct type parameters (no mismatch)
export const Badge = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => <span ref={ref} className={className} {...props} />,
);

// argument-type-mismatch: React.forwardRef for button with extended props (no mismatch)
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
}
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, className, ...props }, ref) => <button ref={ref} className={className} {...props} />,
);

// argument-type-mismatch: React.forwardRef for div with custom props (no mismatch)
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: number;
}
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ elevation, className, ...props }, ref) => <div ref={ref} className={className} {...props} />,
);



// Positive: argument-type-mismatch — callback passing string from mapped array (no actual type mismatch)
declare const Dialog: React.ComponentType<{ open: boolean; onOpenChange: (value: boolean) => void; children: React.ReactNode }>;
declare const OptionItem: React.ComponentType<{ onSelect: () => void; value: string; children: React.ReactNode }>;

interface ChoiceDialogProps {
  handler: { complete: (selection: string | null) => void };
  options: Array<{ label: string }>;
}

export function ChoiceDialog({ handler, options }: ChoiceDialogProps): JSX.Element {
  const labels = options.map((opt) => opt.label);
  
  return (
    <Dialog open={true} onOpenChange={(val) => (!val ? handler.complete(null) : null)}>
      {labels.map((label, idx) => (
        <OptionItem onSelect={() => handler.complete(label)} key={idx} value={label}>
          {label}
        </OptionItem>
      ))}
    </Dialog>
  );
}
