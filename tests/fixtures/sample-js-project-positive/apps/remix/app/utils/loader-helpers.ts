
// Generic wrapper threading: T is passed directly to external call that returns any
declare type AppData = any;
declare function useActionData(): AppData;
declare function deserialize<T>(data: AppData): T;

export function useTypedActionData<T = AppData>(): T | null {
  const data = useActionData();
  return data ? deserialize<T>(data) : null;
}
