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
