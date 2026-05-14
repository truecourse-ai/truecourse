
declare function useLoaderData(): unknown;
declare function deserialize<T>(data: unknown): T;
declare type AppData = Record<string, unknown>;

export function useSuperLoaderData<T = AppData>(): T {
  const data = useLoaderData();
  return deserialize<T>(data);
}
