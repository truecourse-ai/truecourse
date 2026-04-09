import { useEffect, useRef } from 'react';
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
