import { createContext, useContext } from 'react';
const ThemeCtx = createContext('light');
export function OptimizedList(): JSX.Element {
  return <div><p>List</p></div>;
}
export default function CardDisplay({ title, subtitle }: { readonly title: string; readonly subtitle: string }): JSX.Element {
  return <div><h2>{title}</h2><p>{subtitle}</p></div>;
}
export function ContextConsumer({ theme }: { theme: string }): JSX.Element {
  const ctx = useContext(ThemeCtx);
  return <div className={ctx}>{theme}</div>;
}
export function ProviderWithChildren({ children }: { children: JSX.Element }): JSX.Element {
  return <ThemeCtx.Provider value="dark">{children}</ThemeCtx.Provider>;
}
export function ProviderWrappingContainer({ children }: { children: JSX.Element }): JSX.Element {
  return <ThemeCtx.Provider value="dark"><div className="wrapper">{children}</div></ThemeCtx.Provider>;
}

// Positive: hardcoded-url — URL in placeholder attribute (not a real endpoint)
export function UrlPlaceholder(): JSX.Element { return <input placeholder="https://example.com" />; }

// Positive: missing-usememo-expensive — static constant filtering (no deps change)
const ITEMS = ['a', 'b', 'c'];
const FILTERED_ITEMS = ITEMS.filter((x) => x.length > 0);
export function StaticFilter(): JSX.Element { return <div>{FILTERED_ITEMS.length}</div>; }

// Positive: html-table-accessibility — generic table wrapper with children
export function TableWrapper({ children }: { children: JSX.Element }): JSX.Element { return <table><tbody>{children}</tbody></table>; }



// Positive: missing-usememo-expensive — array methods inside useState initializer
// (React only evaluates useState initializers on mount, so these chains do not
// run on every render and should not be flagged).

declare const useState: <S>(initial: S | (() => S)) => [S, (v: S) => void];

interface CheckboxValue { readonly id: number; readonly checked: boolean; readonly value: string }

// Mode shape-350168ad3610: `.map(...).filter(...)` chain passed as the
// useState initializer argument. The chain runs once on mount, not on render.
export function CheckboxFieldInitializer({ raw }: { readonly raw: readonly CheckboxValue[] }): JSX.Element {
  const [checkedValues, setCheckedValues] = useState<readonly string[]>(
    raw
      .map((item) => (item.checked ? (item.value.length > 0 ? item.value : `empty-${item.id}`) : ''))
      .filter(Boolean),
  );
  return <div onClick={() => setCheckedValues([])}>{checkedValues.length}</div>;
}

interface EnvelopeItem { readonly id: string; readonly order: number; readonly title: string }
interface LocalEnvelopeFile { readonly id: string; readonly title: string; readonly isUploading: boolean }

// Mode shape-f81e12025a6f: `.sort(...).map(...)` chain passed as the useState
// initializer argument. The chain runs once on mount, not on render.
export function EnvelopeUploadInitializer({ items }: { readonly items: readonly EnvelopeItem[] }): JSX.Element {
  const [localFiles, setLocalFiles] = useState<readonly LocalEnvelopeFile[]>(
    items
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((item) => ({ id: item.id, title: item.title, isUploading: false })),
  );
  return <ul onClick={() => setLocalFiles([])}>{localFiles.map((f) => <li key={f.id}>{f.title}</li>)}</ul>;
}

interface OrgSettingRoute { readonly path: string; readonly label: string; readonly isSubNav?: boolean }

// Mode shape-c657909602f0: static array literal of route config objects
// terminated by `.filter(...)`. The array contents are string constants and
// the filter is a tiny one-shot config trim, not dynamic per-render data.
export function OrgSettingsLayout({ orgUrl, billingEnabled }: { readonly orgUrl: string; readonly billingEnabled: boolean }): JSX.Element {
  const organisationSettingRoutes: readonly OrgSettingRoute[] = [
    { path: `/o/${orgUrl}/settings/general`, label: 'General' },
    { path: `/o/${orgUrl}/settings/document`, label: 'Preferences' },
    { path: `/o/${orgUrl}/settings/document`, label: 'Document', isSubNav: true },
    { path: `/o/${orgUrl}/settings/branding`, label: 'Branding', isSubNav: true },
    { path: `/o/${orgUrl}/settings/email`, label: 'Email', isSubNav: true },
    { path: `/o/${orgUrl}/settings/email-domains`, label: 'Email Domains' },
    { path: `/o/${orgUrl}/settings/teams`, label: 'Teams' },
    { path: `/o/${orgUrl}/settings/members`, label: 'Members' },
    { path: `/o/${orgUrl}/settings/groups`, label: 'Groups' },
    { path: `/o/${orgUrl}/settings/sso`, label: 'SSO' },
    { path: `/o/${orgUrl}/settings/billing`, label: 'Billing' },
  ].filter((route) => {
    if (!billingEnabled && route.path.includes('/billing')) return false;
    return true;
  });

  return (
    <nav>
      {organisationSettingRoutes.map((r) => (
        <a key={r.path} href={r.path}>{r.label}</a>
      ))}
    </nav>
  );
}
