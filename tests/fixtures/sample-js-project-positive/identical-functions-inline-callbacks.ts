// Inline arrow callbacks passed as object-literal property values are an
// idiomatic call-site pattern (mutation hooks, framework option bags, etc.).
// Two `onSuccess` handlers that happen to dispatch the same one-liner are not
// duplicated logic worth extracting — they're glue at distinct call sites.

interface MutationOptions<T> {
  onSuccess?: (data: T) => void
  onError?: (err: unknown) => void
}

declare function useMutation<T>(opts: MutationOptions<T>): void

declare const cache: {
  invalidate(opts: { key: string }): void
}

export function registerInvalidators(): void {
  useMutation<number>({
    onSuccess: () => {
      cache.invalidate({ key: 'first' })
    },
  })

  useMutation<string>({
    onSuccess: () => {
      cache.invalidate({ key: 'first' })
    },
  })
}
