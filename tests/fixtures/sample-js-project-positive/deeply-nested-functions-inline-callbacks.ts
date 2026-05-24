// Object-literal handler configs (`api({ onSuccess: (x) => ... })`) and
// inline JSX-prop arrows are the idiomatic shape for event handlers and
// data-flow callbacks. Nesting them isn't a "deeply nested function" bug —
// the closures only exist for the lifetime of the parent invocation.

interface SubscriberConfig<T> {
  readonly onSuccess: (data: T) => void;
  readonly onError: (err: Error) => void;
}

declare function subscribe<T>(opts: SubscriberConfig<T>): void;

export function configureSubscribers(): void {
  subscribe<number>({
    onSuccess: (outerValue) => {
      subscribe<string>({
        onSuccess: (innerValue) => {
          subscribe<boolean>({
            onSuccess: (finalValue) => {
              const total = String(finalValue) + innerValue + String(outerValue);
              if (total.length === 0) {
                throw new Error('unexpected empty payload');
              }
            },
            onError: (err) => {
              console.warn('inner failure', err.message);
            },
          });
        },
        onError: (err) => {
          console.error('middle failure', err.stack);
        },
      });
    },
    onError: (err) => {
      console.info('outer failure', err.name);
    },
  });
}
