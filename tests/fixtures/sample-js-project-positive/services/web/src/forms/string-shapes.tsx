/**
 * Magic-string / duplicate-string shapes that should NOT fire:
 * - TanStack queryKey / mutationKey array members.
 * - cn / clsx / cva class-list args.
 * - DOM event-name args (`addEventListener('click', …)`).
 * - Hono / Express response headers (`c.header('X-Foo', …)`).
 */

declare const cn: (...args: readonly string[]) => string;
declare const clsx: (...args: readonly (string | object)[]) => string;
declare const useQuery: <T>(opts: { queryKey: unknown[]; queryFn: () => Promise<T> }) => T;
declare const queryClient: {
  invalidateQueries: (opts: { queryKey: unknown[] }) => void;
  cancelQueries: (opts: { queryKey: unknown[] }) => void;
};
declare const el: HTMLElement;
declare const c: { header: (name: string, value: string) => void };

export interface Output {
  cls1: string;
  cls2: string;
  cls3: string;
  data: number;
}

export function shapes(): Output {
  // TanStack queryKey: same `'user'` key segment repeated across
  // useQuery / invalidate / cancel.
  const data = useQuery({
    queryKey: ['user', 'profile', 'preferences'],
    queryFn: async () => 1,
  });
  queryClient.invalidateQueries({ queryKey: ['user', 'profile', 'preferences'] });
  queryClient.cancelQueries({ queryKey: ['user', 'profile', 'preferences'] });

  // cn / clsx args — same Tailwind class repeated 3+ times.
  const cls1 = cn('rounded-md', 'border-neutral-300', 'shadow-sm');
  const cls2 = cn('rounded-md', 'border-neutral-300', 'hover:bg-neutral-50');
  const cls3 = clsx('rounded-md', 'border-neutral-300');

  // DOM event-name args repeated.
  el.addEventListener('mousedown', () => undefined);
  el.removeEventListener('mousedown', () => undefined);
  el.addEventListener('mousedown', () => undefined);

  // Hono header API — same header name repeated.
  c.header('X-Request-ID', 'abc');
  c.header('X-Request-ID', 'def');
  c.header('X-Request-ID', 'ghi');

  return { cls1, cls2, cls3, data };
}
