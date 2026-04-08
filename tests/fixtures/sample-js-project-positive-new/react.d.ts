/* Local React type declarations for the fixture */

declare module 'react' {
  export interface CSSProperties {
    [key: string]: string | number | undefined;
  }

  export type ReactNode = string | number | boolean | null | undefined | JSX.Element;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type EffectCallback = () => void | (() => void);
  export type Ref<T> = { current: T | null };

  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: EffectCallback, deps?: readonly unknown[]): void;
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useRef<T>(initialValue: T): Ref<T>;
  export function memo<P extends Record<string, unknown>>(component: (props: P) => JSX.Element): (props: P) => JSX.Element;

  const React: {
    useState: typeof useState;
    useEffect: typeof useEffect;
    useCallback: typeof useCallback;
    useMemo: typeof useMemo;
    useRef: typeof useRef;
    memo: typeof memo;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: Record<string, unknown>): JSX.Element;
  export function jsxs(type: unknown, props: Record<string, unknown>): JSX.Element;
}
