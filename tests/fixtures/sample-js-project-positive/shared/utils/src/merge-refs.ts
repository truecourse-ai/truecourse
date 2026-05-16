
type Ref<T> = ((value: T | null) => void) | { current: T | null } | null | undefined;

export function combineRefs<T>(...refs: (Ref<T> | undefined)[]): (value: T | null) => void {
  return (value) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref) {
        (ref as { current: T | null }).current = value;
      }
    });
  };
}
