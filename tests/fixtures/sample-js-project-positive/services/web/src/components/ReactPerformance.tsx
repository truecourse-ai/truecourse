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
